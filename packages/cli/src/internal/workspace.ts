import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RepoPath, type PackageName } from "../Model.ts";
import {
  AlreadyPublic,
  DependsOnPrivate,
  fileSystemFailure,
  type FileSystemFailure,
  MissingName,
  PackageNotFound,
  ProcessFailure,
  ScopeUnset,
  UnexpectedOutput,
} from "../PackageError.ts";
import {
  ALL_DEPENDENCY_FIELDS,
  BUILD_DEPENDENCY_FIELDS,
  decodeText,
  dependencyNames,
  type JsonObject,
  type Manifest,
  serialize,
  withPublishFields,
} from "./manifest.ts";

/**
 * The publishable-package rules. A package is public when its manifest has no
 * `"private": true`; everything a public package must carry is derived from
 * that and from the fragments. `planSync` is the pure core, and the
 * operations below load the workspace from disk, plan, and write.
 */

export interface Member {
  /** `""` for the workspace root. */
  readonly dir: RepoPath;
  readonly kind: "root" | "template" | "package";
  /** The manifest's exact contents. */
  readonly json: JsonObject;
  /** The fields of `json` the CLI reads. */
  readonly manifest: Manifest;
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
  readonly path: RepoPath;
  readonly contents: string;
}

export interface Finding {
  /** The file the finding is about. */
  readonly path: RepoPath;
  readonly problem: string;
  /** `pkg sync` repairs it; otherwise it needs a decision made by hand. */
  readonly fixable: boolean;
}

export interface SyncPlan {
  readonly edits: ReadonlyArray<FileEdit>;
  readonly findings: ReadonlyArray<Finding>;
}

type PathOps = Pick<Path.Path, "join" | "relative">;

const repoPath = (path: PathOps, ...segments: ReadonlyArray<string>) =>
  RepoPath.make(path.join(...segments));

const isPrivate = (member: Member) => member.manifest.private === true;

const BUILD_CONFIG = "tsconfig.build.json";
const REFERENCES = /"references"\s*:\s*\[[^\]]*\]/;

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

/** Every `<member>/package.json (<field>)` that lists `name`, in any dependency field. */
export const dependentsOf = (
  snapshot: Snapshot,
  name: string,
  path: PathOps,
): ReadonlyArray<string> =>
  snapshot.members.flatMap((member) =>
    ALL_DEPENDENCY_FIELDS.filter((field) => name in (member.manifest[field] ?? {})).map(
      (field) => `${path.join(member.dir, "package.json")} (${field})`,
    ),
  );

/** The npm scope public packages publish under, from the root manifest's `repo.npmScope`. */
export const npmScope = (snapshot: Snapshot): string | undefined =>
  snapshot.members.find((member) => member.kind === "root")?.manifest.repo?.npmScope;

const requireScope = (snapshot: Snapshot): Effect.Effect<string, ScopeUnset> => {
  const scope = npmScope(snapshot);
  return scope === undefined ? Effect.fail(new ScopeUnset()) : Effect.succeed(scope);
};

/** Fail early when a public package could not be named, before anything is written. */
export const ensureNpmScope = Effect.fnUntraced(function* (root: string) {
  return yield* requireScope(yield* loadWorkspace(root));
});

export const NPM_SCOPE_UNSET = 'public packages exist but "repo": { "npmScope" } is not set';

/** Sync never deletes, so what a private package should not carry is reported instead. */
const privateLeftovers = (member: Member, path: PathOps): ReadonlyArray<Finding> => {
  const leftovers: Array<Finding> = [];
  const advice = "delete it or make the package public";
  if (member.buildConfig !== undefined) {
    leftovers.push({
      path: repoPath(path, member.dir, BUILD_CONFIG),
      problem: `private package has a build config; ${advice}`,
      fixable: false,
    });
  }
  if (member.manifest.publishConfig !== undefined) {
    leftovers.push({
      path: repoPath(path, member.dir, "package.json"),
      problem: `private package has publishConfig; ${advice}`,
      fixable: false,
    });
  }
  return leftovers;
};

export const planSync = (snapshot: Snapshot, path: PathOps): SyncPlan => {
  const byName = new Map(
    snapshot.members.flatMap((member) =>
      member.manifest.name === undefined ? [] : [[member.manifest.name, member] as const],
    ),
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
    const manifestPath = repoPath(path, member.dir, "package.json");
    const json = withPublishFields(member.json, snapshot.fragments.manifest);
    if (JSON.stringify(json) !== JSON.stringify(member.json)) {
      edits.push({ path: manifestPath, contents: serialize(json) });
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
      .map(({ dependency }) => path.join(path.relative(member.dir, dependency.dir), BUILD_CONFIG))
      .sort();
    const buildConfigPath = repoPath(path, member.dir, BUILD_CONFIG);
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
    findings.push({
      path: RepoPath.make("package.json"),
      problem: NPM_SCOPE_UNSET,
      fixable: false,
    });
  }
  return { edits, findings };
};

/** Fragments ship inside the CLI package, beside the templates. */
const fragmentsDir = (path: Path.Path) => path.resolve(import.meta.dirname, "../../fragments");
export const templatesDir = (path: Path.Path) =>
  path.resolve(import.meta.dirname, "../../templates");

const readManifest = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(file).pipe(fileSystemFailure("read", file));
  return yield* decodeText(text, file);
});

const readIfExists = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(file).pipe(fileSystemFailure("stat", file)))
    ? yield* fs.readFileString(file).pipe(fileSystemFailure("read", file))
    : undefined;
});

const PnpmProjects = Schema.fromJsonString(Schema.Array(Schema.Struct({ path: Schema.String })));

/** Workspace members as pnpm itself resolves the globs in pnpm-workspace.yaml. */
const listMembers = Effect.fnUntraced(function* (root: string) {
  const command = "pnpm ls -r --depth -1 --json";
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* spawner
    .string(ChildProcess.make("pnpm", ["ls", "-r", "--depth", "-1", "--json"], { cwd: root }))
    .pipe(Effect.mapError((cause) => new ProcessFailure({ command, cause })));
  const projects = yield* Schema.decodeEffect(PnpmProjects)(output).pipe(
    Effect.mapError(() => new UnexpectedOutput({ command, output })),
  );
  return projects.map((project) => project.path);
});

/** Read every member's manifest and build config, plus the fragments. */
export const loadWorkspace = Effect.fnUntraced(function* (givenRoot: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // pnpm ls reports real paths, so relate them to the real root: on macOS /tmp
  // is a symlink to /private/tmp, and a repo can be opened through a symlink.
  const root = yield* fs.realPath(givenRoot).pipe(fileSystemFailure("resolve", givenRoot));
  const templates = yield* fs
    .realPath(templatesDir(path))
    .pipe(fileSystemFailure("resolve", templatesDir(path)));

  const members: Array<Member> = [];
  for (const dir of yield* listMembers(root)) {
    const relative = path.relative(root, dir);
    const { json, manifest } = yield* readManifest(path.join(dir, "package.json"));
    members.push({
      dir: RepoPath.make(relative),
      kind:
        relative === ""
          ? "root"
          : path.relative(templates, dir).startsWith("..")
            ? "package"
            : "template",
      json,
      manifest,
      buildConfig: yield* readIfExists(path.join(dir, BUILD_CONFIG)),
    });
  }

  const fragments = fragmentsDir(path);
  const buildConfigFragment = path.join(fragments, BUILD_CONFIG);
  const snapshot: Snapshot = {
    members,
    fragments: {
      buildConfig: yield* fs
        .readFileString(buildConfigFragment)
        .pipe(fileSystemFailure("read", buildConfigFragment)),
      manifest: (yield* readManifest(path.join(fragments, "package.public.json"))).json,
    },
  };
  return snapshot;
});

export interface SyncResult {
  readonly findings: ReadonlyArray<Finding>;
  /** Paths written, empty under `check`. */
  readonly written: ReadonlyArray<RepoPath>;
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
    yield* fs
      .writeFileString(path.join(root, edit.path), edit.contents)
      .pipe(fileSystemFailure("write", edit.path));
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
  root: string,
  dir: string,
  pattern: RegExp,
  to: string,
): Effect.Effect<ReadonlyArray<RepoPath>, FileSystemFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const changed: Array<RepoPath> = [];
    for (const entry of yield* fs.readDirectory(dir).pipe(fileSystemFailure("read", dir))) {
      if (RENAME_PRUNE.has(entry)) {
        continue;
      }
      const full = path.join(dir, entry);
      const info = yield* fs.stat(full).pipe(fileSystemFailure("stat", full));
      if (info.type === "Directory") {
        changed.push(...(yield* renameIn(root, full, pattern, to)));
        continue;
      }
      if (!RENAME_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
        continue;
      }
      const contents = yield* fs.readFileString(full).pipe(fileSystemFailure("read", full));
      const renamed = contents.replace(pattern, to);
      if (renamed !== contents) {
        yield* fs.writeFileString(full, renamed).pipe(fileSystemFailure("write", full));
        changed.push(RepoPath.make(path.relative(root, full)));
      }
    }
    return changed;
  });

export interface MakePublicResult {
  readonly from: string;
  readonly to: string;
  /** Paths sync wrote, for the caller to format. */
  readonly written: ReadonlyArray<RepoPath>;
}

/**
 * Make `packages/<name>` public: rename it into the repo's npm scope across the
 * whole workspace, drop `private`, then sync so it gains everything a public
 * package carries.
 */
export const makePublic = Effect.fnUntraced(function* (root: string, name: PackageName) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const snapshot = yield* loadWorkspace(root);
  const dir = path.join("packages", name);

  const target = snapshot.members.find((member) => member.dir === dir);
  if (target === undefined) {
    return yield* new PackageNotFound({ dir });
  }
  if (!isPrivate(target)) {
    return yield* new AlreadyPublic({ dir });
  }
  const scope = yield* requireScope(snapshot);

  const byName = new Map(snapshot.members.map((member) => [member.manifest.name, member]));
  const privateDeps = dependencyNames(target.manifest, BUILD_DEPENDENCY_FIELDS).filter((dep) => {
    const member = byName.get(dep);
    return member !== undefined && isPrivate(member);
  });
  if (privateDeps.length > 0) {
    return yield* new DependsOnPrivate({ dir, dependencies: privateDeps });
  }

  const from = target.manifest.name;
  if (from === undefined) {
    return yield* new MissingName({ path: path.join(dir, "package.json") });
  }
  const to = `${scope}/${from.split("/").pop() ?? name}`;
  // Not followed by a name character, so renaming @repo/foo leaves @repo/foo-extra alone.
  yield* renameIn(root, root, new RegExp(`${escapeRegExp(from)}(?![\\w-])`, "g"), to);

  const manifestPath = path.join(root, dir, "package.json");
  const { private: _private, ...json } = (yield* readManifest(manifestPath)).json;
  yield* fs
    .writeFileString(manifestPath, serialize(json))
    .pipe(fileSystemFailure("write", manifestPath));

  const { written } = yield* syncWorkspace(root, { check: false });
  return {
    from,
    to,
    written: [repoPath(path, dir, "package.json"), ...written],
  } satisfies MakePublicResult;
});

/** Run the repo formatter over files written as plain `JSON.stringify` output. */
export const formatFiles = Effect.fnUntraced(function* (
  root: string,
  files: ReadonlyArray<RepoPath>,
) {
  if (files.length === 0) {
    return;
  }
  const command = "vp fmt";
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner
    .exitCode(ChildProcess.make("vp", ["fmt", ...files], { cwd: root }))
    .pipe(Effect.mapError((cause) => new ProcessFailure({ command, cause })));
  if (exitCode !== 0) {
    return yield* new ProcessFailure({ command, exitCode });
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
