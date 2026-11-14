import { Data, Effect, type Path } from "effect";
import {
  ALL_DEPENDENCY_FIELDS,
  BUILD_DEPENDENCY_FIELDS,
  decodeText,
  dependencyNames,
  isObject,
  type JsonObject,
  type Manifest,
  serialize,
  withPublishFields,
} from "./internal/manifest.ts";
import { renameText, TEMPLATE_EXTENSIONS, hasExtension } from "./internal/rename.ts";
import {
  BUILD_CONFIG,
  referencesIn,
  retargetExtends,
  spliceReferences,
} from "./internal/tsconfig.ts";
import { type NpmScope, RepoPath, type PackageName, type Visibility } from "./Model.ts";
import {
  AlreadyExists,
  AlreadyPublic,
  DependsOnPrivate,
  HasDependents,
  MissingName,
  PackageNotFound,
  ProtectedPackage,
  ScopeMismatch,
  ScopeUnset,
} from "./PackageError.ts";

/**
 * The pure core of every package operation. A planner reads a `Snapshot` of the
 * workspace and returns a `Plan`: the steps that would carry it out, decided in
 * full before anything is written. Every refusal happens here, so applying a
 * plan only fails when the disk does.
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

/** A template as `pkg add` copies it. */
export interface Template {
  readonly name: string;
  /** Absolute: templates ship inside the CLI, wherever it runs from. */
  readonly dir: string;
  /** Each `.ts` and `.json` file's text, keyed by its path inside the template. */
  readonly files: ReadonlyMap<string, string>;
  /** Directories inside the template that the copy must not keep. */
  readonly pruned: ReadonlyArray<string>;
}

export interface Finding {
  /** The file the finding is about. */
  readonly path: RepoPath;
  readonly problem: string;
  /** `pkg sync` repairs it; otherwise it needs a decision made by hand. */
  readonly fixable: boolean;
}

export type Step = Data.TaggedEnum<{
  /** Copy a directory from outside the repo into it. */
  Copy: { readonly from: string; readonly to: RepoPath };
  Remove: { readonly path: RepoPath };
  Write: { readonly path: RepoPath; readonly contents: string };
}>;
export const Step = Data.taggedEnum<Step>();

export interface Plan {
  /** In the order they run. Copies come first, so later steps can write inside them. */
  readonly steps: ReadonlyArray<Step>;
  readonly findings: ReadonlyArray<Finding>;
}

export interface CreatePlan extends Plan {
  readonly packageName: string;
  readonly packagePath: RepoPath;
}

export interface MakePublicPlan extends Plan {
  readonly from: string;
  readonly to: string;
}

export interface RemovePlan extends Plan {
  readonly packageName: string;
  readonly packagePath: RepoPath;
  /** A public package may also be on npm, which removing it here leaves untouched. */
  readonly wasPublic: boolean;
}

export type PathOps = Pick<Path.Path, "join" | "relative" | "resolve">;

export const PACKAGES_DIR = "packages";

/** The dev CLI itself: removing or publishing it with itself is never what you meant. */
export const PROTECTED_PACKAGES: ReadonlyArray<string> = ["cli"];

export const NPM_SCOPE_UNSET =
  'public packages exist but "monorepoSettings": { "npmScope" } is not set';

const repoPath = (path: PathOps, ...segments: ReadonlyArray<string>) =>
  RepoPath.make(path.join(...segments));

const manifestPath = (path: PathOps, member: Member) => repoPath(path, member.dir, "package.json");

export const isPrivate = (member: Member) => member.manifest.private === true;

/** The npm scope public packages publish under, from the root manifest's `monorepoSettings.npmScope`. */
export const npmScope = (snapshot: Snapshot): string | undefined =>
  snapshot.members.find((member) => member.kind === "root")?.manifest.monorepoSettings?.npmScope;

/** Every `<member>/package.json (<field>)` that lists `name`, in any dependency field. */
export const dependentsOf = (
  snapshot: Snapshot,
  name: string,
  path: PathOps,
): ReadonlyArray<string> =>
  snapshot.members.flatMap((member) =>
    ALL_DEPENDENCY_FIELDS.filter((field) => name in (member.manifest[field] ?? {})).map(
      (field) => `${manifestPath(path, member)} (${field})`,
    ),
  );

/** `packages/<name>` members that `pkg make-public` may convert, never the CLI. */
export const privatePackages = (
  snapshot: Snapshot,
  path: Pick<Path.Path, "basename" | "dirname">,
) =>
  snapshot.members
    .filter((m) => m.kind === "package" && isPrivate(m) && path.dirname(m.dir) === PACKAGES_DIR)
    .map((m) => path.basename(m.dir))
    .filter((name) => !PROTECTED_PACKAGES.includes(name))
    .sort();

/** `packages/<name>` members that `pkg rm` may delete, never the CLI. */
export const removablePackages = (
  snapshot: Snapshot,
  path: Pick<Path.Path, "basename" | "dirname">,
) =>
  snapshot.members
    .filter((m) => m.kind === "package" && path.dirname(m.dir) === PACKAGES_DIR)
    .map((m) => path.basename(m.dir))
    .filter((name) => !PROTECTED_PACKAGES.includes(name))
    .sort();

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
      path: manifestPath(path, member),
      problem: `private package has publishConfig; ${advice}`,
      fixable: false,
    });
  }
  return leftovers;
};

/**
 * What every public package must carry, derived from its manifest and the
 * fragments: the publish fields, and a build config referencing each public
 * workspace package it builds against.
 */
export const planSync = (snapshot: Snapshot, path: PathOps): Plan => {
  const byName = new Map(
    snapshot.members.flatMap((member) =>
      member.manifest.name === undefined ? [] : [[member.manifest.name, member] as const],
    ),
  );
  const scope = npmScope(snapshot);
  const steps: Array<Step> = [];
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
    const manifest = manifestPath(path, member);
    const json = withPublishFields(member.json, snapshot.fragments.manifest);
    if (JSON.stringify(json) !== JSON.stringify(member.json)) {
      steps.push(Step.Write({ path: manifest, contents: serialize(json) }));
      findings.push({ path: manifest, problem: "package.json is out of sync", fixable: true });
    }
    // The scope is the single source of truth once set; moving a package into it is a rename, by hand.
    const name = member.manifest.name;
    if (scope !== undefined && name !== undefined && !name.startsWith(`${scope}/`)) {
      findings.push({
        path: manifest,
        problem: `public package ${name} is outside the repo's npm scope ${scope}`,
        fixable: false,
      });
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
          path: manifest,
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
      steps.push(
        Step.Write({ path: buildConfigPath, contents: spliceReferences(buildConfig, references) }),
      );
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
  if (anyPublic && scope === undefined) {
    findings.push({
      path: RepoPath.make("package.json"),
      problem: NPM_SCOPE_UNSET,
      fixable: false,
    });
  }
  return { steps, findings };
};

/**
 * A plan under construction. Writing a member's manifest or build config also
 * updates the snapshot, so a sync run on the draft sees the workspace as the
 * plan leaves it. Writes are keyed by path, so a later write to a file replaces
 * an earlier one rather than adding a second step.
 */
const makeDraft = (initial: Snapshot, path: PathOps) => {
  let snapshot = initial;
  const structural: Array<Step> = [];
  const writes = new Map<RepoPath, string>();

  const updateMember = (dir: RepoPath, update: (member: Member) => Member) => {
    snapshot = {
      ...snapshot,
      members: snapshot.members.map((member) => (member.dir === dir ? update(member) : member)),
    };
  };

  const write = Effect.fnUntraced(function* (file: RepoPath, contents: string) {
    writes.set(file, contents);
    for (const member of snapshot.members) {
      if (file === manifestPath(path, member)) {
        const decoded = yield* decodeText(contents, file);
        updateMember(member.dir, (m) => ({ ...m, ...decoded }));
      } else if (file === repoPath(path, member.dir, BUILD_CONFIG)) {
        updateMember(member.dir, (m) => ({ ...m, buildConfig: contents }));
      }
    }
  });

  return {
    snapshot: () => snapshot,
    /** The text this plan has given `file` so far, if any. */
    read: (file: RepoPath) => writes.get(file),
    write,
    copy: (from: string, to: RepoPath) => {
      structural.push(Step.Copy({ from, to }));
    },
    remove: (target: RepoPath) => {
      structural.push(Step.Remove({ path: target }));
      snapshot = { ...snapshot, members: snapshot.members.filter((m) => m.dir !== target) };
    },
    addMember: (member: Member) => {
      snapshot = { ...snapshot, members: [...snapshot.members, member] };
    },
    /** Fold in the writes sync would make to the workspace as this plan leaves it. */
    sync: Effect.fnUntraced(function* () {
      for (const step of planSync(snapshot, path).steps) {
        if (step._tag === "Write") {
          yield* write(step.path, step.contents);
        }
      }
    }),
    steps: (): ReadonlyArray<Step> => [
      ...structural,
      ...[...writes].map(([file, contents]) => Step.Write({ path: file, contents })),
    ],
  };
};

type Draft = ReturnType<typeof makeDraft>;

/**
 * The scope a public package is named into: the repo's own, or `given` when
 * the repo has none yet, in which case the plan also records it in the root
 * manifest as `monorepoSettings.npmScope`.
 */
const resolveScope = Effect.fnUntraced(function* (
  draft: Draft,
  path: PathOps,
  given: NpmScope | undefined,
) {
  const configured = npmScope(draft.snapshot());
  if (given === undefined) {
    return configured ?? (yield* new ScopeUnset());
  }
  if (configured !== undefined) {
    return configured === given ? configured : yield* new ScopeMismatch({ configured, given });
  }
  const root = draft.snapshot().members.find((member) => member.kind === "root");
  if (root === undefined) {
    return yield* new PackageNotFound({ dir: "package.json" });
  }
  const current = root.json["monorepoSettings"];
  const settings: JsonObject = isObject(current) ? current : {};
  yield* draft.write(
    manifestPath(path, root),
    serialize({ ...root.json, monorepoSettings: { ...settings, npmScope: given } }),
  );
  return given;
});

/** Refuse a member that would publish against a private workspace package. */
const ensurePublishable = (snapshot: Snapshot, member: Member) => {
  const byName = new Map(snapshot.members.map((m) => [m.manifest.name, m]));
  const privateDeps = dependencyNames(member.manifest, BUILD_DEPENDENCY_FIELDS).filter((dep) => {
    const dependency = byName.get(dep);
    return dependency !== undefined && isPrivate(dependency);
  });
  return privateDeps.length > 0
    ? Effect.fail(new DependsOnPrivate({ dir: member.dir, dependencies: privateDeps }))
    : Effect.void;
};

/**
 * The step `pkg add --public` and `pkg make-public` share: drop `private` from
 * the member's manifest, then sync so it gains everything a public package carries.
 */
const publish = Effect.fnUntraced(function* (draft: Draft, dir: RepoPath, path: PathOps) {
  const member = draft.snapshot().members.find((m) => m.dir === dir);
  if (member === undefined) {
    return yield* new PackageNotFound({ dir });
  }
  const { private: _private, ...json } = member.json;
  yield* draft.write(manifestPath(path, member), serialize(json));
  yield* draft.sync();
});

/** The source files a workspace-wide rename reads, keyed by repo path. */
export type Sources = ReadonlyMap<RepoPath, string>;

/**
 * Make `packages/<name>` public: rename it into the repo's npm scope in every
 * source file and manifest, drop `private`, and sync.
 */
export const planMakePublic = Effect.fn("Plan.makePublic")(function* (
  snapshot: Snapshot,
  sources: Sources,
  name: PackageName,
  path: PathOps,
  scope?: NpmScope,
) {
  const dir = repoPath(path, PACKAGES_DIR, name);
  const target = snapshot.members.find((member) => member.dir === dir);
  if (target === undefined) {
    return yield* new PackageNotFound({ dir });
  }
  if (!isPrivate(target)) {
    return yield* new AlreadyPublic({ dir });
  }
  const draft = makeDraft(snapshot, path);
  const resolved = yield* resolveScope(draft, path, scope);
  yield* ensurePublishable(snapshot, target);
  const from = target.manifest.name;
  if (from === undefined) {
    return yield* new MissingName({ path: manifestPath(path, target) });
  }
  const to = `${resolved}/${from.split("/").pop() ?? name}`;

  for (const [file, original] of sources) {
    // Read through the draft: the scope may already have been written to the root manifest.
    const contents = draft.read(file) ?? original;
    const renamed = renameText(contents, from, to);
    if (renamed !== contents) {
      yield* draft.write(file, renamed);
    }
  }
  yield* publish(draft, dir, path);
  return { steps: draft.steps(), findings: [], from, to } satisfies MakePublicPlan;
});

/**
 * Copy a template to `packages/<name>`, repointing the template's own package
 * name at the new one and its tsconfig `extends` at the new depth. A public
 * package is named into the scope as it is copied, then published exactly as
 * `pkg make-public` would.
 */
export const planCreate = Effect.fn("Plan.create")(function* (
  snapshot: Snapshot,
  template: Template,
  name: PackageName,
  visibility: Visibility,
  root: string,
  path: PathOps,
  scope?: NpmScope,
) {
  const packagePath = repoPath(path, PACKAGES_DIR, name);
  if (snapshot.members.some((member) => member.dir === packagePath)) {
    return yield* new AlreadyExists({ dir: packagePath });
  }
  const draft = makeDraft(snapshot, path);
  const packageName =
    visibility === "public"
      ? `${yield* resolveScope(draft, path, scope)}/${name}`
      : `@repo/${name}`;

  // The template's own package name is the string to repoint, so templates are
  // free to name themselves anything without the CLI knowing about it.
  const templateManifest = template.files.get("package.json");
  if (templateManifest === undefined) {
    return yield* new MissingName({ path: path.join(template.dir, "package.json") });
  }
  const templatePackageName = (yield* decodeText(templateManifest, template.dir)).manifest.name;
  if (templatePackageName === undefined) {
    return yield* new MissingName({ path: path.join(template.dir, "package.json") });
  }

  draft.copy(template.dir, packagePath);
  for (const pruned of template.pruned) {
    draft.remove(repoPath(path, packagePath, pruned));
  }

  const target = path.resolve(root, packagePath);
  const copied = new Map<string, string>();
  for (const [file, contents] of template.files) {
    if (!hasExtension(file, TEMPLATE_EXTENSIONS)) {
      continue;
    }
    const renamed = contents.replaceAll(templatePackageName, packageName);
    copied.set(
      file,
      file === "tsconfig.json" ? retargetExtends(renamed, template.dir, target, path) : renamed,
    );
  }

  const manifestText = copied.get("package.json") ?? templateManifest;
  const decoded = yield* decodeText(manifestText, repoPath(path, packagePath, "package.json"));
  const member: Member = {
    dir: packagePath,
    kind: "package",
    ...decoded,
    buildConfig: copied.get(BUILD_CONFIG),
  };
  if (visibility === "public") {
    yield* ensurePublishable(snapshot, member);
  }
  draft.addMember(member);
  for (const [file, contents] of copied) {
    if (contents !== template.files.get(file)) {
      yield* draft.write(repoPath(path, packagePath, file), contents);
    }
  }

  if (visibility === "public") {
    yield* publish(draft, packagePath, path);
  }
  return { steps: draft.steps(), findings: [], packageName, packagePath } satisfies CreatePlan;
});

/**
 * Delete `packages/<name>`, then sync. Refuses a protected name, a directory
 * that is not a workspace member, and a package any member still depends on.
 */
export const planRemove = Effect.fn("Plan.remove")(function* (
  snapshot: Snapshot,
  name: PackageName,
  path: PathOps,
) {
  const packagePath = repoPath(path, PACKAGES_DIR, name);
  if (PROTECTED_PACKAGES.includes(name)) {
    return yield* new ProtectedPackage({ dir: packagePath });
  }
  const target = snapshot.members.find((member) => member.dir === packagePath);
  if (target === undefined) {
    return yield* new PackageNotFound({ dir: packagePath });
  }
  const packageName = target.manifest.name ?? `@repo/${name}`;
  const dependents = dependentsOf(snapshot, packageName, path);
  if (dependents.length > 0) {
    return yield* new HasDependents({ packageName, dependents });
  }

  const draft = makeDraft(snapshot, path);
  draft.remove(packagePath);
  yield* draft.sync();
  return {
    steps: draft.steps(),
    findings: [],
    packageName,
    packagePath,
    wasPublic: !isPrivate(target),
  } satisfies RemovePlan;
});
