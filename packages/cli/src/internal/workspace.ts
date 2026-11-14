import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RepoPath, type PackageName, type Visibility } from "../Model.ts";
import {
  AlreadyExists,
  fileSystemFailure,
  type FileSystemFailure,
  NoWorkspaceRoot,
  ProcessFailure,
  UnexpectedOutput,
  UnknownTemplate,
  WORKSPACE_MARKER,
} from "../PackageError.ts";
import {
  type Member,
  type Plan,
  planCreate,
  planMakePublic,
  planRemove,
  planSync,
  privatePackages,
  removablePackages,
  type Snapshot,
  type Sources,
  Step,
  type Template,
} from "../Plan.ts";
import { decodeText } from "./manifest.ts";
import {
  hasExtension,
  TEMPLATE_EXTENSIONS,
  TEMPLATE_PRUNE,
  WORKSPACE_EXTENSIONS,
  WORKSPACE_PRUNE,
} from "./rename.ts";
import { BUILD_CONFIG } from "./tsconfig.ts";

/**
 * Everything that touches the disk: loading what the planners read, and
 * applying the plans they return.
 */

/** Fragments and templates ship inside the CLI package, wherever it runs from. */
const fragmentsDir = (path: Path.Path) => path.resolve(import.meta.dirname, "../../fragments");
const templatesDir = (path: Path.Path) => path.resolve(import.meta.dirname, "../../templates");

/**
 * Walk up from `start` until the workspace root is found, so the command works
 * from any directory in the repo.
 */
export const findRepoRoot = Effect.fnUntraced(function* (start: string) {
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

interface Walked {
  /** Text of each file with a matching extension, keyed by its path under the walk's root. */
  readonly files: Map<string, string>;
  /** Pruned directories that exist, by path under the walk's root. */
  readonly pruned: Array<string>;
}

/** Collect the text files under `dir`, recording rather than entering pruned directories. */
const walk = (
  dir: string,
  prune: ReadonlySet<string>,
  extensions: ReadonlyArray<string>,
  under = "",
  found: Walked = { files: new Map(), pruned: [] },
): Effect.Effect<Walked, FileSystemFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
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
export const loadSources = Effect.fnUntraced(function* (root: string) {
  const { files } = yield* walk(root, WORKSPACE_PRUNE, WORKSPACE_EXTENSIONS);
  const sources: Sources = new Map(
    [...files].map(([file, contents]) => [RepoPath.make(file), contents]),
  );
  return sources;
});

/** Directory names under `dir` that contain a `package.json`, sorted. */
const packageDirs = Effect.fnUntraced(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(dir).pipe(fileSystemFailure("stat", dir)))) {
    return [];
  }
  const entries = yield* fs.readDirectory(dir).pipe(fileSystemFailure("read", dir));
  const found: Array<string> = [];
  for (const entry of [...entries].sort()) {
    const manifest = path.join(dir, entry, "package.json");
    if (yield* fs.exists(manifest).pipe(fileSystemFailure("stat", manifest))) {
      found.push(entry);
    }
  }
  return found;
});

/**
 * Every template directory that looks like a package. Read from disk so adding
 * a directory is all it takes to offer a new choice.
 */
export const listTemplates = Effect.fnUntraced(function* () {
  const path = yield* Path.Path;
  return yield* packageDirs(templatesDir(path));
});

export const loadTemplate = Effect.fnUntraced(function* (name: string) {
  const path = yield* Path.Path;
  const available = yield* listTemplates();
  if (!available.includes(name)) {
    return yield* new UnknownTemplate({ template: name, available });
  }
  const dir = path.join(templatesDir(path), name);
  const { files, pruned } = yield* walk(dir, TEMPLATE_PRUNE, TEMPLATE_EXTENSIONS);
  return { name, dir, files, pruned } satisfies Template;
});

/** Run the repo formatter over the files a plan wrote. */
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

/**
 * Carry out a plan's steps in order, then format what it wrote. A directory a
 * copy created is removed again if any later step fails, so a failed
 * `pkg add` leaves nothing behind.
 */
export const applyPlan = Effect.fnUntraced(function* (root: string, plan: Plan) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
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
    Effect.andThen(formatFiles(root, written)),
    Effect.onError(() => rollback),
  );
  return written;
});

export interface SyncResult {
  readonly findings: Plan["findings"];
  /** Paths written, empty under `check`. */
  readonly written: ReadonlyArray<RepoPath>;
}

/** Plan against the workspace on disk and, unless checking, apply it. */
export const syncWorkspace = Effect.fnUntraced(function* (
  root: string,
  options: { readonly check: boolean },
) {
  const path = yield* Path.Path;
  const plan = planSync(yield* loadWorkspace(root), path);
  if (options.check) {
    return { findings: plan.findings, written: [] } satisfies SyncResult;
  }
  return {
    // What sync just repaired is no longer a finding; what needs a decision still is.
    findings: plan.findings.filter((finding) => !finding.fixable),
    written: yield* applyPlan(root, plan),
  } satisfies SyncResult;
});

export const makePublic = Effect.fnUntraced(function* (root: string, name: PackageName) {
  const path = yield* Path.Path;
  const plan = yield* planMakePublic(
    yield* loadWorkspace(root),
    yield* loadSources(root),
    name,
    path,
  );
  yield* applyPlan(root, plan);
  return plan;
});

export const createPackage = Effect.fnUntraced(function* (
  root: string,
  name: PackageName,
  templateName: string,
  visibility: Visibility,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const template = yield* loadTemplate(templateName);
  // A directory that is not a workspace member still blocks the copy.
  const target = path.join("packages", name);
  if (yield* fs.exists(path.join(root, target)).pipe(fileSystemFailure("stat", target))) {
    return yield* new AlreadyExists({ dir: target });
  }
  const plan = yield* planCreate(
    yield* loadWorkspace(root),
    template,
    name,
    visibility,
    root,
    path,
  );
  yield* applyPlan(root, plan);
  return plan;
});

/** Plan `pkg rm` without deleting anything, so the CLI can refuse before it asks. */
export const planRemoval = Effect.fnUntraced(function* (root: string, name: PackageName) {
  const path = yield* Path.Path;
  return yield* planRemove(yield* loadWorkspace(root), name, path);
});

export const listPrivatePackages = Effect.fnUntraced(function* (root: string) {
  const path = yield* Path.Path;
  return privatePackages(yield* loadWorkspace(root), path);
});

export const listRemovablePackages = Effect.fnUntraced(function* (root: string) {
  const path = yield* Path.Path;
  return removablePackages(yield* loadWorkspace(root), path);
});
