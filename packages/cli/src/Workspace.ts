import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { decodeText } from "./internal/manifest.ts";
import {
  hasExtension,
  TEMPLATE_EXTENSIONS,
  TEMPLATE_PRUNE,
  WORKSPACE_EXTENSIONS,
  WORKSPACE_PRUNE,
} from "./internal/rename.ts";
import { BUILD_CONFIG } from "./internal/tsconfig.ts";
import { type NpmScope, RepoPath, type PackageName, type Visibility } from "./Model.ts";
import {
  AlreadyExists,
  type AlreadyPublic,
  type DependsOnPrivate,
  fileSystemFailure,
  type FileSystemFailure,
  type HasDependents,
  type InvalidManifest,
  type MissingName,
  NoWorkspaceRoot,
  type PackageNotFound,
  type ProcessFailure,
  type ProtectedPackage,
  type ScopeMismatch,
  type ScopeUnset,
  type UnexpectedOutput,
  UnknownTemplate,
  WORKSPACE_MARKER,
} from "./PackageError.ts";
import {
  type CreatePlan,
  type MakePublicPlan,
  type Member,
  npmScope,
  type Plan,
  PACKAGES_DIR,
  planCreate,
  planMakePublic,
  planRemove,
  planSync,
  privatePackages,
  type RemovePlan,
  removablePackages,
  type Snapshot,
  type Sources,
  Step,
  type Template,
} from "./Plan.ts";
import * as Toolchain from "./Toolchain.ts";

/**
 * The repo the CLI is working in. Every operation is a plan first: the
 * `plan*` methods read the workspace and return what they would do, refusing
 * before anything is written, and `apply` carries a plan out. Commands decide
 * in between whether to confirm, print the plan instead, or install after.
 */

/** Failures reading the workspace from disk. */
export type LoadError = FileSystemFailure | InvalidManifest | ProcessFailure | UnexpectedOutput;

export interface Service {
  /** Absolute path of the workspace root. */
  readonly root: string;
  /** Template names `pkg add` offers. */
  readonly templates: Effect.Effect<ReadonlyArray<string>, FileSystemFailure>;
  readonly template: (name: string) => Effect.Effect<Template, UnknownTemplate | FileSystemFailure>;
  /** The root manifest's `monorepoSettings.npmScope`, when one is set. */
  readonly npmScope: Effect.Effect<string | undefined, LoadError>;
  /** Private `packages/<name>` members `pkg make-public` may convert. */
  readonly privatePackages: Effect.Effect<ReadonlyArray<string>, LoadError>;
  /** `packages/<name>` members `pkg rm` may delete. */
  readonly removablePackages: Effect.Effect<ReadonlyArray<string>, LoadError>;
  readonly planSync: Effect.Effect<Plan, LoadError>;
  /** `scope` names a repo that has none yet; the plan then records it in the root manifest. */
  readonly planCreate: (
    template: Template,
    name: PackageName,
    visibility: Visibility,
    scope?: NpmScope,
  ) => Effect.Effect<
    CreatePlan,
    | LoadError
    | AlreadyExists
    | ScopeUnset
    | ScopeMismatch
    | MissingName
    | DependsOnPrivate
    | PackageNotFound
  >;
  readonly planMakePublic: (
    name: PackageName,
    scope?: NpmScope,
  ) => Effect.Effect<
    MakePublicPlan,
    | LoadError
    | PackageNotFound
    | AlreadyPublic
    | ScopeUnset
    | ScopeMismatch
    | DependsOnPrivate
    | MissingName
  >;
  readonly planRemove: (
    name: PackageName,
  ) => Effect.Effect<RemovePlan, LoadError | ProtectedPackage | PackageNotFound | HasDependents>;
  /**
   * Carry out a plan's steps in order, then format what it wrote, returning
   * those paths. A directory a copy created is removed again if any later step
   * fails, so a failed `pkg add` leaves nothing behind.
   */
  readonly apply: (
    plan: Plan,
  ) => Effect.Effect<ReadonlyArray<RepoPath>, FileSystemFailure | ProcessFailure>;
  /** Relink the workspace after members were added, renamed or removed. */
  readonly install: Effect.Effect<void, ProcessFailure>;
}

export class Workspace extends Context.Service<Workspace, Service>()("@repo/cli/Workspace") {}

interface Walked {
  /** Text of each file with a matching extension, keyed by its path under the walk's root. */
  readonly files: Map<string, string>;
  /** Pruned directories that exist, by path under the walk's root. */
  readonly pruned: Array<string>;
}

/** Build the workspace service for `root`, which must already be the workspace root. */
export const make = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const toolchain = yield* Toolchain.Toolchain;

  /** Fragments and templates ship inside the CLI package, wherever it runs from. */
  const fragmentsDir = path.resolve(import.meta.dirname, "../fragments");
  const templatesDir = path.resolve(import.meta.dirname, "../templates");

  const readManifest = Effect.fnUntraced(function* (file: string) {
    const text = yield* fs.readFileString(file).pipe(fileSystemFailure("read", file));
    return yield* decodeText(text, file);
  });

  const readIfExists = Effect.fnUntraced(function* (file: string) {
    return (yield* fs.exists(file).pipe(fileSystemFailure("stat", file)))
      ? yield* fs.readFileString(file).pipe(fileSystemFailure("read", file))
      : undefined;
  });

  /** Every member's manifest and build config, plus the fragments. */
  const load = Effect.fn("Workspace.load")(function* () {
    // pnpm ls reports real paths, so relate them to the real root: on macOS /tmp
    // is a symlink to /private/tmp, and a repo can be opened through a symlink.
    const realRoot = yield* fs.realPath(root).pipe(fileSystemFailure("resolve", root));
    const templates = yield* fs
      .realPath(templatesDir)
      .pipe(fileSystemFailure("resolve", templatesDir));

    const members: Array<Member> = [];
    for (const dir of yield* toolchain.listMembers(realRoot)) {
      const relative = path.relative(realRoot, dir);
      members.push({
        dir: RepoPath.make(relative),
        kind:
          relative === ""
            ? "root"
            : path.relative(templates, dir).startsWith("..")
              ? "package"
              : "template",
        ...(yield* readManifest(path.join(dir, "package.json"))),
        buildConfig: yield* readIfExists(path.join(dir, BUILD_CONFIG)),
      });
    }

    const buildConfigFragment = path.join(fragmentsDir, BUILD_CONFIG);
    const snapshot: Snapshot = {
      members,
      fragments: {
        buildConfig: yield* fs
          .readFileString(buildConfigFragment)
          .pipe(fileSystemFailure("read", buildConfigFragment)),
        manifest: (yield* readManifest(path.join(fragmentsDir, "package.public.json"))).json,
      },
    };
    return snapshot;
  });

  /** Collect the text files under `dir`, recording rather than entering pruned directories. */
  const walk = (
    dir: string,
    prune: ReadonlySet<string>,
    extensions: ReadonlyArray<string>,
    under = "",
    found: Walked = { files: new Map(), pruned: [] },
  ): Effect.Effect<Walked, FileSystemFailure> =>
    Effect.gen(function* () {
      for (const entry of yield* fs.readDirectory(dir).pipe(fileSystemFailure("read", dir))) {
        const relative = under === "" ? entry : path.join(under, entry);
        if (prune.has(entry)) {
          found.pruned.push(relative);
          continue;
        }
        const full = path.join(dir, entry);
        const info = yield* fs.stat(full).pipe(fileSystemFailure("stat", full));
        if (info.type === "Directory") {
          yield* walk(full, prune, extensions, relative, found);
        } else if (hasExtension(entry, extensions)) {
          found.files.set(
            relative,
            yield* fs.readFileString(full).pipe(fileSystemFailure("read", full)),
          );
        }
      }
      return found;
    });

  /** Every source file and manifest a workspace-wide rename could touch. */
  const loadSources = Effect.fn("Workspace.loadSources")(function* () {
    const { files } = yield* walk(root, WORKSPACE_PRUNE, WORKSPACE_EXTENSIONS);
    const sources: Sources = new Map(
      [...files].map(([file, contents]) => [RepoPath.make(file), contents]),
    );
    return sources;
  });

  /**
   * Every template directory that looks like a package. Read from disk so
   * adding a directory is all it takes to offer a new choice.
   */
  const templates = Effect.gen(function* () {
    const entries = yield* fs
      .readDirectory(templatesDir)
      .pipe(fileSystemFailure("read", templatesDir));
    const found: Array<string> = [];
    for (const entry of [...entries].sort()) {
      const manifest = path.join(templatesDir, entry, "package.json");
      if (yield* fs.exists(manifest).pipe(fileSystemFailure("stat", manifest))) {
        found.push(entry);
      }
    }
    return found;
  });

  const template = Effect.fn("Workspace.template")(function* (name: string) {
    const available = yield* templates;
    if (!available.includes(name)) {
      return yield* new UnknownTemplate({ template: name, available });
    }
    const dir = path.join(templatesDir, name);
    const { files, pruned } = yield* walk(dir, TEMPLATE_PRUNE, TEMPLATE_EXTENSIONS);
    return { name, dir, files, pruned } satisfies Template;
  });

  const planCreateIn = Effect.fn("Workspace.planCreate")(function* (
    chosen: Template,
    name: PackageName,
    visibility: Visibility,
    scope?: NpmScope,
  ) {
    // A directory that is not a workspace member still blocks the copy.
    const target = path.join(PACKAGES_DIR, name);
    if (yield* fs.exists(path.join(root, target)).pipe(fileSystemFailure("stat", target))) {
      return yield* new AlreadyExists({ dir: target });
    }
    return yield* planCreate(yield* load(), chosen, name, visibility, root, path, scope);
  });

  const planMakePublicIn = Effect.fn("Workspace.planMakePublic")(function* (
    name: PackageName,
    scope?: NpmScope,
  ) {
    return yield* planMakePublic(yield* load(), yield* loadSources(), name, path, scope);
  });

  const planRemoveIn = Effect.fn("Workspace.planRemove")(function* (name: PackageName) {
    return yield* planRemove(yield* load(), name, path);
  });

  const apply = Effect.fn("Workspace.apply")(function* (plan: Plan) {
    const copied: Array<string> = [];
    const run = Effect.forEach(
      plan.steps,
      Step.$match({
        Copy: ({ from, to }) => {
          copied.push(path.join(root, to));
          return fs.copy(from, path.join(root, to)).pipe(fileSystemFailure("copy", from));
        },
        Remove: (step) =>
          fs
            .remove(path.join(root, step.path), { recursive: true, force: true })
            .pipe(fileSystemFailure("remove", step.path)),
        Write: (step) =>
          fs
            .writeFileString(path.join(root, step.path), step.contents)
            .pipe(fileSystemFailure("write", step.path)),
      }),
      { discard: true },
    );
    const rollback = Effect.forEach(
      copied,
      (dir) => fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore),
      { discard: true },
    );

    const written = plan.steps.flatMap((step) => (step._tag === "Write" ? [step.path] : []));
    yield* run.pipe(
      Effect.andThen(toolchain.format(root, written)),
      Effect.onError(() => rollback),
    );
    return written;
  });

  return Workspace.of({
    root,
    templates,
    template,
    npmScope: Effect.map(load(), npmScope),
    privatePackages: Effect.map(load(), (snapshot) => privatePackages(snapshot, path)),
    removablePackages: Effect.map(load(), (snapshot) => removablePackages(snapshot, path)),
    planSync: Effect.map(load(), (snapshot) => planSync(snapshot, path)),
    planCreate: planCreateIn,
    planMakePublic: planMakePublicIn,
    planRemove: planRemoveIn,
    apply,
    install: toolchain.install(root),
  });
});

/** The workspace rooted at `root`, which must already be its root. */
export const layerAt = (root: string) => Layer.effect(Workspace, make(root));

/**
 * Walk up from `start` until the workspace root is found, so the command works
 * from any directory in the repo.
 */
const findRoot = Effect.fn("Workspace.findRoot")(function* (start: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let current = path.resolve(start);
  for (;;) {
    const marker = path.join(current, WORKSPACE_MARKER);
    if (yield* fs.exists(marker).pipe(fileSystemFailure("stat", marker))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return yield* new NoWorkspaceRoot({ start });
    }
    current = parent;
  }
});

/** The workspace containing the current directory. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return layerAt(yield* findRoot(path.resolve()));
  }),
);
