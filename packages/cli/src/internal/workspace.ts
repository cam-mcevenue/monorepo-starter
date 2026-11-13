import { Data, Effect, FileSystem, Path, type PlatformError } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * The publishable-package rules. A package is public when its manifest has no
 * `"private": true`; everything a public package must carry is derived from
 * that and from the fragments. `planSync` is the pure core, and the
 * operations below load the workspace from disk, plan, and write.
 */

export class WorkspaceError extends Data.TaggedError("WorkspaceError")<{
  readonly message: string;
}> {}

/** Collapse a library failure into a `WorkspaceError` naming the step. */
const orFail = <A>(
  effect: Effect.Effect<A, PlatformError.PlatformError>,
  message: string,
): Effect.Effect<A, WorkspaceError> =>
  effect.pipe(
    Effect.mapError((cause) => new WorkspaceError({ message: `${message}: ${cause.message}` })),
  );

export type Json = null | boolean | number | string | ReadonlyArray<Json> | JsonObject;
export interface JsonObject {
  readonly [key: string]: Json;
}

export interface Member {
  /** Repo-relative directory, `""` for the workspace root. */
  readonly dir: string;
  readonly kind: "root" | "template" | "package";
  readonly manifest: JsonObject;
  /** Raw `tsconfig.build.json` text, when the file exists. */
  readonly buildConfig: string | undefined;
}

export interface Snapshot {
  readonly members: ReadonlyArray<Member>;
  readonly fragments: {
    /** Raw text of `fragments/tsconfig.build.json`. */
    readonly buildConfig: string;
    /** Parsed `fragments/package.public.json`. */
    readonly manifest: JsonObject;
  };
}

export interface FileEdit {
  /** Repo-relative file path. */
  readonly path: string;
  readonly contents: string;
}

export interface Finding {
  /** Repo-relative path of the file the finding is about. */
  readonly path: string;
  readonly problem: string;
  /** `pkg sync` repairs it; otherwise it needs a decision made by hand. */
  readonly fixable: boolean;
}

export interface SyncPlan {
  readonly edits: ReadonlyArray<FileEdit>;
  readonly findings: ReadonlyArray<Finding>;
}

type PathOps = Pick<Path.Path, "join" | "relative">;

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `./src/X.ts` → `./dist/X.js`, recursing into condition objects. */
const toPublished = (target: Json): Json => {
  if (typeof target === "string") {
    return target.replace(/^\.\/src\//, "./dist/").replace(/\.ts$/, ".js");
  }
  if (isObject(target)) {
    return Object.fromEntries(
      Object.entries(target).map(([key, value]) => [key, toPublished(value)]),
    );
  }
  return target;
};

const serialize = (value: Json) => `${JSON.stringify(value, null, 2)}\n`;

const MANIFEST_EXPORT = "./package.json";

/** Tools read a published manifest by name, so the export always leads the map. */
const withManifestExport = (exports: Json | undefined): JsonObject => {
  const map = isObject(exports) ? exports : {};
  return MANIFEST_EXPORT in map ? map : { [MANIFEST_EXPORT]: MANIFEST_EXPORT, ...map };
};

/**
 * Deep-merge the fragment into a manifest. Fragment values win, keys keep the
 * manifest's order with new ones appended, and `files` is a union so a package
 * can ship extras beyond the fragment's required entries.
 */
const mergeFragment = (target: JsonObject, fragment: JsonObject, atRoot: boolean): JsonObject => {
  const merged: Record<string, Json> = { ...target };
  for (const [key, value] of Object.entries(fragment)) {
    const existing = target[key];
    if (atRoot && key === "files" && Array.isArray(value)) {
      const current = Array.isArray(existing) ? existing : [];
      merged[key] = [...current, ...value.filter((entry) => !current.includes(entry))];
    } else if (isObject(value) && isObject(existing)) {
      merged[key] = mergeFragment(existing, value, false);
    } else {
      merged[key] = value;
    }
  }
  return merged;
};

const syncManifest = (member: Member, fragment: JsonObject): JsonObject => {
  const merged = mergeFragment(member.manifest, fragment, true);
  const exports = withManifestExport(merged["exports"]);
  const publishConfig = isObject(merged["publishConfig"]) ? merged["publishConfig"] : {};
  return {
    ...merged,
    exports,
    publishConfig: { ...publishConfig, exports: toPublished(exports) },
  };
};

const isPrivate = (member: Member) => member.manifest["private"] === true;

const BUILD_CONFIG = "tsconfig.build.json";
const REFERENCES = /"references"\s*:\s*\[[^\]]*\]/;

/** Fields whose workspace entries the build needs: devDependencies only reach tests. */
const BUILD_DEPENDENCY_FIELDS = ["dependencies", "peerDependencies"];

const dependencyNames = (manifest: JsonObject, fields: ReadonlyArray<string>) =>
  fields.flatMap((field) => {
    const deps = manifest[field];
    return isObject(deps) ? Object.keys(deps) : [];
  });

const referencesIn = (buildConfig: string): ReadonlyArray<string> | undefined => {
  const match = REFERENCES.exec(buildConfig);
  return match === null
    ? undefined
    : [...match[0].matchAll(/"path"\s*:\s*"([^"]+)"/g)].map((entry) => entry[1] ?? "");
};

const renderReferences = (paths: ReadonlyArray<string>) =>
  paths.length === 0
    ? `"references": []`
    : `"references": [\n${paths.map((p) => `    { "path": "${p}" }`).join(",\n")}\n  ]`;

/**
 * Replace only the `references` array, as text, so JSONC comments elsewhere in
 * the file survive. A config without one gets it as its first property.
 */
const spliceReferences = (buildConfig: string, paths: ReadonlyArray<string>) =>
  REFERENCES.test(buildConfig)
    ? buildConfig.replace(REFERENCES, renderReferences(paths))
    : buildConfig.replace("{", `{\n  ${renderReferences(paths)},`);

const ALL_DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "devDependencies"];

/** Every `<member>/package.json (<field>)` that lists `name`, in any dependency field. */
export const dependentsOf = (
  snapshot: Snapshot,
  name: string,
  path: PathOps,
): ReadonlyArray<string> =>
  snapshot.members.flatMap((member) =>
    ALL_DEPENDENCY_FIELDS.filter((field) => {
      const deps = member.manifest[field];
      return isObject(deps) && name in deps;
    }).map((field) => `${path.join(member.dir, "package.json")} (${field})`),
  );

/** The npm scope public packages publish under, from the root manifest's `repo.npmScope`. */
export const npmScope = (snapshot: Snapshot): string | undefined => {
  const root = snapshot.members.find((member) => member.kind === "root");
  const repo = root?.manifest["repo"];
  const scope = isObject(repo) ? repo["npmScope"] : undefined;
  return typeof scope === "string" ? scope : undefined;
};

export const NPM_SCOPE_UNSET = 'public packages exist but "repo": { "npmScope" } is not set';

/** Sync never deletes, so what a private package should not carry is reported instead. */
const privateLeftovers = (member: Member, path: PathOps): ReadonlyArray<Finding> => {
  const leftovers: Array<Finding> = [];
  const advice = "delete it or make the package public";
  if (member.buildConfig !== undefined) {
    leftovers.push({
      path: path.join(member.dir, BUILD_CONFIG),
      problem: `private package has a build config; ${advice}`,
      fixable: false,
    });
  }
  if ("publishConfig" in member.manifest) {
    leftovers.push({
      path: path.join(member.dir, "package.json"),
      problem: `private package has publishConfig; ${advice}`,
      fixable: false,
    });
  }
  return leftovers;
};

export const planSync = (snapshot: Snapshot, path: PathOps): SyncPlan => {
  const byName = new Map(
    snapshot.members.flatMap((member) => {
      const name = member.manifest["name"];
      return typeof name === "string" ? [[name, member] as const] : [];
    }),
  );
  const edits: Array<FileEdit> = [];
  const findings: Array<Finding> = [];
  for (const member of snapshot.members) {
    if (member.kind === "root") {
      continue;
    }
    if (isPrivate(member)) {
      findings.push(...privateLeftovers(member, path));
      continue;
    }
    // Compared by value: the formatter owns layout, so text differences are not drift.
    // Key order is safe too: the merge keeps every existing key where it was.
    const manifestPath = path.join(member.dir, "package.json");
    const manifest = syncManifest(member, snapshot.fragments.manifest);
    if (JSON.stringify(manifest) !== JSON.stringify(member.manifest)) {
      edits.push({ path: manifestPath, contents: serialize(manifest) });
      findings.push({ path: manifestPath, problem: "package.json is out of sync", fixable: true });
    }

    const workspaceDeps = dependencyNames(member.manifest, BUILD_DEPENDENCY_FIELDS).flatMap(
      (name) => {
        const dependency = byName.get(name);
        return dependency === undefined ? [] : [{ name, dependency }];
      },
    );
    for (const { name, dependency } of workspaceDeps) {
      if (isPrivate(dependency)) {
        findings.push({
          path: manifestPath,
          problem: `depends on private workspace package ${name}`,
          fixable: false,
        });
      }
    }
    const references = workspaceDeps
      .filter(({ dependency }) => !isPrivate(dependency))
      .map(({ dependency }) => dependency)
      .map((dependency) => path.join(path.relative(member.dir, dependency.dir), BUILD_CONFIG))
      .sort();
    const buildConfigPath = path.join(member.dir, BUILD_CONFIG);
    const buildConfig = member.buildConfig ?? snapshot.fragments.buildConfig;
    const referencesStale =
      JSON.stringify(referencesIn(buildConfig)) !== JSON.stringify(references);
    if (member.buildConfig === undefined || referencesStale) {
      edits.push({ path: buildConfigPath, contents: spliceReferences(buildConfig, references) });
      findings.push({
        path: buildConfigPath,
        problem:
          member.buildConfig === undefined
            ? "tsconfig.build.json is missing"
            : "references are out of sync",
        fixable: true,
      });
    }
  }
  const anyPublic = snapshot.members.some((m) => m.kind !== "root" && !isPrivate(m));
  if (anyPublic && npmScope(snapshot) === undefined) {
    findings.push({ path: "package.json", problem: NPM_SCOPE_UNSET, fixable: false });
  }
  return { edits, findings };
};

/** Fragments ship inside the CLI package, beside the templates. */
const fragmentsDir = (path: Path.Path) => path.resolve(import.meta.dirname, "../../fragments");
const templatesDir = (path: Path.Path) => path.resolve(import.meta.dirname, "../../templates");

const parseJson = (text: string, file: string): Effect.Effect<JsonObject, WorkspaceError> =>
  Effect.try({
    try: () => JSON.parse(text) as JsonObject,
    catch: () => new WorkspaceError({ message: `${file} is not valid JSON` }),
  });

const readJson = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* parseJson(yield* orFail(fs.readFileString(file), `Failed to read ${file}`), file);
});

const readIfExists = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* orFail(fs.exists(file), `Failed to stat ${file}`))
    ? yield* orFail(fs.readFileString(file), `Failed to read ${file}`)
    : undefined;
});

interface PnpmProject {
  readonly path: string;
}

/** Workspace members as pnpm itself resolves the globs in pnpm-workspace.yaml. */
const listMembers = Effect.fnUntraced(function* (root: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* orFail(
    spawner.string(
      ChildProcess.make("pnpm", ["ls", "-r", "--depth", "-1", "--json"], { cwd: root }),
    ),
    "Failed to list workspace members with pnpm ls",
  );
  const projects = yield* Effect.try({
    try: () => JSON.parse(output) as ReadonlyArray<PnpmProject>,
    catch: () => new WorkspaceError({ message: `pnpm ls printed unexpected output: ${output}` }),
  });
  return projects.map((project) => project.path);
});

/** Read every member's manifest and build config, plus the fragments. */
export const loadWorkspace = Effect.fnUntraced(function* (root: string) {
  const path = yield* Path.Path;
  const templates = templatesDir(path);

  const members: Array<Member> = [];
  for (const dir of yield* listMembers(root)) {
    const relative = path.relative(root, dir);
    members.push({
      dir: relative,
      kind:
        relative === ""
          ? "root"
          : path.relative(templates, dir).startsWith("..")
            ? "package"
            : "template",
      manifest: yield* readJson(path.join(dir, "package.json")),
      buildConfig: yield* readIfExists(path.join(dir, BUILD_CONFIG)),
    });
  }

  const fragments = fragmentsDir(path);
  const buildConfigFragment = path.join(fragments, BUILD_CONFIG);
  const snapshot: Snapshot = {
    members,
    fragments: {
      buildConfig: yield* orFail(
        (yield* FileSystem.FileSystem).readFileString(buildConfigFragment),
        `Failed to read ${buildConfigFragment}`,
      ),
      manifest: yield* readJson(path.join(fragments, "package.public.json")),
    },
  };
  return snapshot;
});

export interface SyncResult {
  readonly findings: ReadonlyArray<Finding>;
  /** Repo-relative paths written, empty under `check`. */
  readonly written: ReadonlyArray<string>;
}

/** Plan against the workspace on disk and, unless checking, apply the edits. */
export const syncWorkspace = Effect.fnUntraced(function* (
  root: string,
  options: { readonly check: boolean },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const plan = planSync(yield* loadWorkspace(root), path);
  if (options.check) {
    return { findings: plan.findings, written: [] } satisfies SyncResult;
  }
  for (const edit of plan.edits) {
    const full = path.join(root, edit.path);
    yield* orFail(fs.writeFileString(full, edit.contents), `Failed to write ${edit.path}`);
  }
  return {
    // What sync just repaired is no longer a finding; what needs a decision still is.
    findings: plan.findings.filter((finding) => !finding.fixable),
    written: plan.edits.map((edit) => edit.path),
  } satisfies SyncResult;
});

/** Directories a workspace-wide rename never enters. */
const RENAME_PRUNE = new Set(["node_modules", "dist", ".git", "coverage"]);
const RENAME_EXTENSIONS = [".ts", ".tsx", ".json"];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Rewrite a package name in every source and manifest under `dir`, returning files changed. */
const renameIn = (
  dir: string,
  pattern: RegExp,
  to: string,
): Effect.Effect<ReadonlyArray<string>, WorkspaceError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const changed: Array<string> = [];
    for (const entry of yield* orFail(fs.readDirectory(dir), `Failed to read ${dir}`)) {
      if (RENAME_PRUNE.has(entry)) {
        continue;
      }
      const full = path.join(dir, entry);
      const info = yield* orFail(fs.stat(full), `Failed to stat ${full}`);
      if (info.type === "Directory") {
        changed.push(...(yield* renameIn(full, pattern, to)));
        continue;
      }
      if (!RENAME_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
        continue;
      }
      const contents = yield* orFail(fs.readFileString(full), `Failed to read ${full}`);
      const renamed = contents.replace(pattern, to);
      if (renamed !== contents) {
        yield* orFail(fs.writeFileString(full, renamed), `Failed to write ${full}`);
        changed.push(full);
      }
    }
    return changed;
  });

export interface MakePublicResult {
  readonly from: string;
  readonly to: string;
  /** Repo-relative paths sync wrote, for the caller to format. */
  readonly written: ReadonlyArray<string>;
}

/**
 * Make `packages/<name>` public: rename it into the repo's npm scope across the
 * whole workspace, drop `private`, then sync so it gains everything a public
 * package carries.
 */
export const makePublic = Effect.fnUntraced(function* (root: string, name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const snapshot = yield* loadWorkspace(root);
  const dir = path.join("packages", name);

  const target = snapshot.members.find((member) => member.dir === dir);
  if (target === undefined) {
    return yield* new WorkspaceError({ message: `${dir} is not a workspace package` });
  }
  if (!isPrivate(target)) {
    return yield* new WorkspaceError({ message: `${dir} is already public` });
  }
  const scope = npmScope(snapshot);
  if (scope === undefined) {
    return yield* new WorkspaceError({
      message: `Set the npm scope first: add "repo": { "npmScope": "@your-scope" } to the root package.json`,
    });
  }

  const byName = new Map(snapshot.members.map((member) => [member.manifest["name"], member]));
  const privateDeps = dependencyNames(target.manifest, BUILD_DEPENDENCY_FIELDS).filter((dep) => {
    const member = byName.get(dep);
    return member !== undefined && isPrivate(member);
  });
  if (privateDeps.length > 0) {
    return yield* new WorkspaceError({
      message: `${dir} depends on private workspace packages, make them public first: ${privateDeps.join(", ")}`,
    });
  }

  const from = target.manifest["name"];
  if (typeof from !== "string") {
    return yield* new WorkspaceError({ message: `${dir}/package.json has no "name" field` });
  }
  const to = `${scope}/${from.split("/").pop() ?? name}`;
  // Not followed by a name character, so renaming @repo/foo leaves @repo/foo-extra alone.
  yield* renameIn(root, new RegExp(`${escapeRegExp(from)}(?![\\w-])`, "g"), to);

  const manifestPath = path.join(root, dir, "package.json");
  const { private: _private, ...manifest } = yield* readJson(manifestPath);
  yield* orFail(
    fs.writeFileString(manifestPath, serialize(manifest)),
    `Failed to write ${manifestPath}`,
  );

  const { written } = yield* syncWorkspace(root, { check: false });
  return {
    from,
    to,
    written: [path.join(dir, "package.json"), ...written],
  } satisfies MakePublicResult;
});

/** Run the repo formatter over files written as plain `JSON.stringify` output. */
export const formatFiles = Effect.fnUntraced(function* (
  root: string,
  files: ReadonlyArray<string>,
) {
  if (files.length === 0) {
    return;
  }
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* orFail(
    spawner.exitCode(ChildProcess.make("vp", ["fmt", ...files], { cwd: root })),
    "Failed to run vp fmt",
  );
  if (exitCode !== 0) {
    return yield* new WorkspaceError({ message: `vp fmt exited with ${exitCode}` });
  }
});

/** Private packages that `pkg make-public` may convert: `packages/<name>`, never the CLI. */
export const listPrivatePackages = Effect.fnUntraced(function* (root: string) {
  const path = yield* Path.Path;
  const snapshot = yield* loadWorkspace(root);
  return snapshot.members
    .filter((m) => m.kind === "package" && isPrivate(m) && path.dirname(m.dir) === "packages")
    .map((m) => path.basename(m.dir))
    .filter((name) => name !== "cli")
    .sort();
});
