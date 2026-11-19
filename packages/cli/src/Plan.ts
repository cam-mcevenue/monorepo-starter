import { Data, Effect, Path } from "effect";
import * as Manifest from "./internal/manifest.ts";
import * as Message from "./internal/message.ts";
import * as Rename from "./internal/rename.ts";
import * as TsConfig from "./internal/tsconfig.ts";
import type * as Model from "./Model.ts";
import * as PackageError from "./PackageError.ts";

/**
 * The pure core of every package operation. A planner reads a `Snapshot` of the
 * workspace and returns a `Plan`: the steps that would carry it out, decided in
 * full before anything is written. Every refusal happens here, so applying a
 * plan only fails when the disk does.
 *
 * Paths are absolute inside, under the snapshot's real root, and relative only
 * at the edges: in text written into config files (relative, with `/`), and
 * in messages shown to people (relative to the root). Planners take the
 * platform's `Path` service from context, the same one the disk work uses.
 */

export interface Member {
  /** Absolute; the snapshot's `root` for the workspace root. */
  readonly dir: string;
  readonly kind: "root" | "template" | "package";
  /** The manifest's exact contents. */
  readonly json: Manifest.JsonObject;
  /** The fields of `json` the CLI reads. */
  readonly manifest: Manifest.Manifest;
  /** Raw `tsconfig.build.json` text, when the file exists. */
  readonly buildConfig: string | undefined;
}

export interface Snapshot {
  /** Absolute, with symlinks resolved, as pnpm reports member paths. */
  readonly root: string;
  readonly members: ReadonlyArray<Member>;
  readonly fragments: {
    /** Raw text of `fragments/tsconfig.build.json`. */
    readonly buildConfig: string;
    /** Parsed `fragments/package.public.json`. */
    readonly manifest: Manifest.JsonObject;
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
  /** Absolute path of the file the finding is about. */
  readonly path: string;
  readonly problem: Message.Message;
  /** `pkg sync` repairs it; otherwise it needs a decision made by hand. */
  readonly fixable: boolean;
}

/** Every path absolute. */
export type Step = Data.TaggedEnum<{
  /** Copy a directory from outside the repo into it. */
  Copy: { readonly from: string; readonly to: string };
  Remove: { readonly path: string };
  Write: { readonly path: string; readonly contents: string };
}>;
export const Step = Data.taggedEnum<Step>();

export interface Plan {
  /** In the order they run. Copies come first, so later steps can write inside them. */
  readonly steps: ReadonlyArray<Step>;
  readonly findings: ReadonlyArray<Finding>;
}

export interface CreatePlan extends Plan {
  readonly packageName: string;
  /** Absolute. */
  readonly packagePath: string;
}

export interface MakePublicPlan extends Plan {
  readonly from: string;
  readonly to: string;
}

export interface RemovePlan extends Plan {
  readonly packageName: string;
  /** Absolute. */
  readonly packagePath: string;
  /** A public package may also be on npm, which removing it here leaves untouched. */
  readonly wasPublic: boolean;
}

/** The source files a workspace-wide rename reads, keyed by absolute path. */
export type Sources = ReadonlyMap<string, string>;

export const PACKAGES_DIR = "packages";

/** The dev CLI itself: removing or publishing it with itself is never what you meant. */
export const PROTECTED_PACKAGES: ReadonlyArray<string> = ["cli"];

export const NPM_SCOPE_UNSET = Message.msg`public packages exist but ${Message.code('"monorepoSettings": { "npmScope" }')} is not set`;

const manifestPath = (path: Path.Path, member: Member) => path.join(member.dir, "package.json");

/** A path as shown to people: relative to the repo root. */
const shown = (path: Path.Path, snapshot: Snapshot, target: string) =>
  path.relative(snapshot.root, target);

export const isPrivate = (member: Member) => member.manifest.private === true;

/** The npm scope public packages publish under, from the root manifest's `monorepoSettings.npmScope`. */
export const npmScope = (snapshot: Snapshot): string | undefined =>
  snapshot.members.find((member) => member.kind === "root")?.manifest.monorepoSettings?.npmScope;

/** Every `<member>/package.json (<field>)` that lists `name`, in any dependency field. */
const dependentsOf = (snapshot: Snapshot, name: string, path: Path.Path): ReadonlyArray<string> =>
  snapshot.members.flatMap((member) =>
    Manifest.ALL_DEPENDENCY_FIELDS.filter((field) => name in (member.manifest[field] ?? {})).map(
      (field) => `${shown(path, snapshot, manifestPath(path, member))} (${field})`,
    ),
  );

/** Names of the `packages/<name>` members that `keep` accepts, never the CLI, sorted. */
const packagesWhere = Effect.fnUntraced(function* (
  snapshot: Snapshot,
  keep: (member: Member) => boolean,
) {
  const path = yield* Path.Path;
  const packagesDir = path.join(snapshot.root, PACKAGES_DIR);
  return snapshot.members
    .filter((m) => m.kind === "package" && path.dirname(m.dir) === packagesDir && keep(m))
    .map((m) => path.basename(m.dir))
    .filter((name) => !PROTECTED_PACKAGES.includes(name))
    .sort();
});

/** `packages/<name>` members that `pkg make-public` may convert. */
export const privatePackages = (snapshot: Snapshot) => packagesWhere(snapshot, isPrivate);

/** `packages/<name>` members that `pkg rm` may delete. */
export const removablePackages = (snapshot: Snapshot) => packagesWhere(snapshot, () => true);

/** Sync never deletes, so what a private package should not carry is reported instead. */
const privateLeftovers = (member: Member, path: Path.Path): ReadonlyArray<Finding> => {
  const leftovers: Array<Finding> = [];
  const advice = "delete it or make the package public";
  if (member.buildConfig !== undefined) {
    leftovers.push({
      path: path.join(member.dir, TsConfig.BUILD_CONFIG),
      problem: Message.msg`private package has a build config; ${advice}`,
      fixable: false,
    });
  }
  if (member.manifest.publishConfig !== undefined) {
    leftovers.push({
      path: manifestPath(path, member),
      problem: Message.msg`private package has ${Message.code("publishConfig")}; ${advice}`,
      fixable: false,
    });
  }
  return leftovers;
};

/** Name the package's scope, the setting it should match, and the name to rename it to. */
const outsideScope = (name: string, scope: string): Message.Message => {
  const [own = "", ...rest] = name.split("/");
  const isScoped = own.startsWith("@") && rest.length > 0;
  const setting = Message.msg`${Message.code(`"monorepoSettings": { "npmScope": "${scope}" }`)} in the root ${Message.code("package.json")}`;
  const renamed = Message.code(`${scope}/${isScoped ? rest.join("/") : name}`);
  return isScoped
    ? Message.msg`public package ${Message.code(name)} has scope ${Message.code(own)}, which does not match ${setting}; rename it to ${renamed}`
    : Message.msg`public package ${Message.code(name)} has no scope, but ${setting} sets one; rename it to ${renamed}`;
};

/** `sync` with the path service in hand, for the draft to run mid-plan. */
const syncWith = (snapshot: Snapshot, path: Path.Path): Plan => {
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
    const json = Manifest.withPublishFields(member.json, snapshot.fragments.manifest);
    if (JSON.stringify(json) !== JSON.stringify(member.json)) {
      steps.push(Step.Write({ path: manifest, contents: Manifest.serialize(json) }));
      findings.push({
        path: manifest,
        problem: Message.msg`${Message.code("package.json")} is out of sync`,
        fixable: true,
      });
    }
    // The scope is the single source of truth once set; moving a package into it is a rename, by hand.
    const name = member.manifest.name;
    if (scope !== undefined && name !== undefined && !name.startsWith(`${scope}/`)) {
      findings.push({ path: manifest, problem: outsideScope(name, scope), fixable: false });
    }

    const workspaceDeps = Manifest.dependencyNames(
      member.manifest,
      Manifest.BUILD_DEPENDENCY_FIELDS,
    ).flatMap((name) => {
      const dependency = byName.get(name);
      return dependency === undefined ? [] : [{ name, dependency }];
    });
    for (const { name, dependency } of workspaceDeps) {
      if (isPrivate(dependency)) {
        findings.push({
          path: manifest,
          problem: Message.msg`depends on private workspace package ${Message.code(name)}`,
          fixable: false,
        });
      }
    }
    // Written into the file, so relative to the package and with `/` on every platform.
    const references = workspaceDeps
      .filter(({ dependency }) => !isPrivate(dependency))
      .map(({ dependency }) =>
        TsConfig.toPosix(
          path,
          path.join(path.relative(member.dir, dependency.dir), TsConfig.BUILD_CONFIG),
        ),
      )
      .sort();
    const buildConfigPath = path.join(member.dir, TsConfig.BUILD_CONFIG);
    const buildConfig = member.buildConfig ?? snapshot.fragments.buildConfig;
    const referencesStale =
      JSON.stringify(TsConfig.referencesIn(buildConfig)) !== JSON.stringify(references);
    if (member.buildConfig === undefined || referencesStale) {
      steps.push(
        Step.Write({
          path: buildConfigPath,
          contents: TsConfig.spliceReferences(buildConfig, references),
        }),
      );
      findings.push({
        path: buildConfigPath,
        problem:
          member.buildConfig === undefined
            ? Message.msg`${Message.code(TsConfig.BUILD_CONFIG)} is missing`
            : Message.msg`${Message.code("references")} are out of sync`,
        fixable: true,
      });
    }
  }
  const anyPublic = snapshot.members.some((m) => m.kind !== "root" && !isPrivate(m));
  if (anyPublic && scope === undefined) {
    findings.push({
      path: path.join(snapshot.root, "package.json"),
      problem: NPM_SCOPE_UNSET,
      fixable: false,
    });
  }
  return { steps, findings };
};

/**
 * What every public package must carry, derived from its manifest and the
 * fragments: the publish fields, and a build config referencing each public
 * workspace package it builds against.
 */
export const sync = Effect.fn("Plan.sync")(function* (snapshot: Snapshot) {
  return syncWith(snapshot, yield* Path.Path);
});

/**
 * A plan under construction. Writing a member's manifest or build config also
 * updates the snapshot, so a sync run on the draft sees the workspace as the
 * plan leaves it. Writes are keyed by path, so a later write to a file replaces
 * an earlier one rather than adding a second step.
 */
const makeDraft = (initial: Snapshot, path: Path.Path) => {
  let snapshot = initial;
  const structural: Array<Step> = [];
  const writes = new Map<string, string>();

  const updateMember = (dir: string, update: (member: Member) => Member) => {
    snapshot = {
      ...snapshot,
      members: snapshot.members.map((member) => (member.dir === dir ? update(member) : member)),
    };
  };

  const write = Effect.fnUntraced(function* (file: string, contents: string) {
    writes.set(file, contents);
    for (const member of snapshot.members) {
      if (file === manifestPath(path, member)) {
        const decoded = yield* Manifest.decodeText(contents, shown(path, snapshot, file));
        updateMember(member.dir, (m) => ({ ...m, ...decoded }));
      } else if (file === path.join(member.dir, TsConfig.BUILD_CONFIG)) {
        updateMember(member.dir, (m) => ({ ...m, buildConfig: contents }));
      }
    }
  });

  return {
    snapshot: () => snapshot,
    /** The text this plan has given `file` so far, if any. */
    read: (file: string) => writes.get(file),
    write,
    copy: (from: string, to: string) => {
      structural.push(Step.Copy({ from, to }));
    },
    remove: (target: string) => {
      structural.push(Step.Remove({ path: target }));
      snapshot = { ...snapshot, members: snapshot.members.filter((m) => m.dir !== target) };
    },
    addMember: (member: Member) => {
      snapshot = { ...snapshot, members: [...snapshot.members, member] };
    },
    /** Fold in the writes sync would make to the workspace as this plan leaves it. */
    sync: Effect.fnUntraced(function* () {
      for (const step of syncWith(snapshot, path).steps) {
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
  path: Path.Path,
  given: Model.NpmScope | undefined,
) {
  const configured = npmScope(draft.snapshot());
  if (given === undefined) {
    return configured ?? (yield* new PackageError.ScopeUnset());
  }
  if (configured !== undefined) {
    return configured === given
      ? configured
      : yield* new PackageError.ScopeMismatch({ configured, given });
  }
  const root = draft.snapshot().members.find((member) => member.kind === "root");
  if (root === undefined) {
    return yield* new PackageError.PackageNotFound({ dir: "package.json" });
  }
  const current = root.json["monorepoSettings"];
  const settings: Manifest.JsonObject = Manifest.isObject(current) ? current : {};
  yield* draft.write(
    manifestPath(path, root),
    Manifest.serialize({ ...root.json, monorepoSettings: { ...settings, npmScope: given } }),
  );
  return given;
});

/** Refuse a member that would publish against a private workspace package. */
const ensurePublishable = (snapshot: Snapshot, member: Member, path: Path.Path) => {
  const byName = new Map(snapshot.members.map((m) => [m.manifest.name, m]));
  const privateDeps = Manifest.dependencyNames(
    member.manifest,
    Manifest.BUILD_DEPENDENCY_FIELDS,
  ).filter((dep) => {
    const dependency = byName.get(dep);
    return dependency !== undefined && isPrivate(dependency);
  });
  return privateDeps.length > 0
    ? Effect.fail(
        new PackageError.DependsOnPrivate({
          dir: shown(path, snapshot, member.dir),
          dependencies: privateDeps,
        }),
      )
    : Effect.void;
};

/**
 * The step `pkg add --public` and `pkg make-public` share: drop `private` from
 * the member's manifest, then sync so it gains everything a public package carries.
 */
const publish = Effect.fnUntraced(function* (draft: Draft, dir: string, path: Path.Path) {
  const member = draft.snapshot().members.find((m) => m.dir === dir);
  if (member === undefined) {
    return yield* new PackageError.PackageNotFound({ dir: shown(path, draft.snapshot(), dir) });
  }
  const { private: _private, ...json } = member.json;
  yield* draft.write(manifestPath(path, member), Manifest.serialize(json));
  yield* draft.sync();
});

/**
 * Make `packages/<name>` public: rename it into the repo's npm scope in every
 * source file and manifest, drop `private`, and sync.
 */
export const makePublic = Effect.fn("Plan.makePublic")(function* (
  snapshot: Snapshot,
  sources: Sources,
  name: Model.PackageName,
  scope?: Model.NpmScope,
) {
  const path = yield* Path.Path;
  const dir = path.join(snapshot.root, PACKAGES_DIR, name);
  const target = snapshot.members.find((member) => member.dir === dir);
  if (target === undefined) {
    return yield* new PackageError.PackageNotFound({ dir: shown(path, snapshot, dir) });
  }
  if (!isPrivate(target)) {
    return yield* new PackageError.AlreadyPublic({ dir: shown(path, snapshot, dir) });
  }
  const draft = makeDraft(snapshot, path);
  const resolved = yield* resolveScope(draft, path, scope);
  yield* ensurePublishable(snapshot, target, path);
  const from = target.manifest.name;
  if (from === undefined) {
    return yield* new PackageError.MissingName({
      path: shown(path, snapshot, manifestPath(path, target)),
    });
  }
  const to = `${resolved}/${from.split("/").pop() ?? name}`;

  for (const [file, original] of sources) {
    // Read through the draft: the scope may already have been written to the root manifest.
    const contents = draft.read(file) ?? original;
    const renamed = Rename.inText(contents, from, to);
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
export const create = Effect.fn("Plan.create")(function* (
  snapshot: Snapshot,
  template: Template,
  name: Model.PackageName,
  visibility: Model.Visibility,
  scope?: Model.NpmScope,
) {
  const path = yield* Path.Path;
  const packagePath = path.join(snapshot.root, PACKAGES_DIR, name);
  if (snapshot.members.some((member) => member.dir === packagePath)) {
    return yield* new PackageError.AlreadyExists({ dir: shown(path, snapshot, packagePath) });
  }
  const draft = makeDraft(snapshot, path);
  const packageName =
    visibility === "public"
      ? `${yield* resolveScope(draft, path, scope)}/${name}`
      : `@repo/${name}`;

  // The template's own package name is the string to repoint, so templates are
  // free to name themselves anything without the CLI knowing about it.
  const templateManifestPath = path.join(template.dir, "package.json");
  const templateManifest = template.files.get("package.json");
  if (templateManifest === undefined) {
    return yield* new PackageError.MissingName({ path: templateManifestPath });
  }
  const templatePackageName = (yield* Manifest.decodeText(templateManifest, templateManifestPath))
    .manifest.name;
  if (templatePackageName === undefined) {
    return yield* new PackageError.MissingName({ path: templateManifestPath });
  }

  draft.copy(template.dir, packagePath);
  for (const pruned of template.pruned) {
    draft.remove(path.join(packagePath, pruned));
  }

  const copied = new Map<string, string>();
  for (const [file, contents] of template.files) {
    if (!Rename.hasExtension(file, Rename.TEMPLATE_EXTENSIONS)) {
      continue;
    }
    const renamed = contents.replaceAll(templatePackageName, packageName);
    copied.set(
      file,
      file === "tsconfig.json"
        ? TsConfig.retargetExtends(renamed, template.dir, packagePath, path)
        : renamed,
    );
  }

  const manifestFile = path.join(packagePath, "package.json");
  const manifestText = copied.get("package.json") ?? templateManifest;
  const decoded = yield* Manifest.decodeText(manifestText, shown(path, snapshot, manifestFile));
  const member: Member = {
    dir: packagePath,
    kind: "package",
    ...decoded,
    buildConfig: copied.get(TsConfig.BUILD_CONFIG),
  };
  if (visibility === "public") {
    yield* ensurePublishable(snapshot, member, path);
  }
  draft.addMember(member);
  for (const [file, contents] of copied) {
    if (contents !== template.files.get(file)) {
      yield* draft.write(path.join(packagePath, file), contents);
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
export const remove = Effect.fn("Plan.remove")(function* (
  snapshot: Snapshot,
  name: Model.PackageName,
) {
  const path = yield* Path.Path;
  const packagePath = path.join(snapshot.root, PACKAGES_DIR, name);
  if (PROTECTED_PACKAGES.includes(name)) {
    return yield* new PackageError.ProtectedPackage({ dir: shown(path, snapshot, packagePath) });
  }
  const target = snapshot.members.find((member) => member.dir === packagePath);
  if (target === undefined) {
    return yield* new PackageError.PackageNotFound({ dir: shown(path, snapshot, packagePath) });
  }
  const packageName = target.manifest.name ?? `@repo/${name}`;
  const dependents = dependentsOf(snapshot, packageName, path);
  if (dependents.length > 0) {
    return yield* new PackageError.HasDependents({ packageName, dependents });
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
