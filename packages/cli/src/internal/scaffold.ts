import { Effect, FileSystem, Path } from "effect";
import { RepoPath, type PackageName, type Visibility } from "../Model.ts";
import {
  AlreadyExists,
  fileSystemFailure,
  type FileSystemFailure,
  HasDependents,
  MissingName,
  NoWorkspaceRoot,
  PackageNotFound,
  ProtectedPackage,
  UnknownTemplate,
  WORKSPACE_MARKER,
} from "../PackageError.ts";
import { decodeText } from "./manifest.ts";
import {
  dependentsOf,
  ensureNpmScope,
  loadWorkspace,
  makePublic,
  syncWorkspace,
  templatesDir,
} from "./workspace.ts";

/**
 * Internal implementation of `pkg add` and `pkg rm`. The command module owns
 * the CLI surface; this module owns the filesystem work.
 */

const PACKAGES_DIR = "packages";

/** The dev CLI itself — removing it with itself is never what you meant. */
export const PROTECTED_PACKAGES: ReadonlyArray<string> = ["cli"];

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

/** Directory names under `full` that contain a `package.json`, sorted. */
const listPackageDirs = Effect.fnUntraced(function* (full: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  if (!(yield* fs.exists(full).pipe(fileSystemFailure("stat", full)))) {
    return [] as Array<string>;
  }
  const entries = yield* fs.readDirectory(full).pipe(fileSystemFailure("read", full));

  const found: Array<string> = [];
  for (const entry of [...entries].sort()) {
    const manifest = path.join(full, entry, "package.json");
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
  return yield* listPackageDirs(templatesDir(path));
});

/** Packages that `pkg rm` is allowed to delete — never offer the CLI itself. */
export const listRemovablePackages = Effect.fnUntraced(function* (root: string) {
  const path = yield* Path.Path;
  const packages = yield* listPackageDirs(path.join(root, PACKAGES_DIR));
  return packages.filter((name) => !PROTECTED_PACKAGES.includes(name));
});

/** Directories that must never be carried over from the template. */
const PRUNE = ["node_modules", "dist"];

const REWRITE_EXTENSIONS = [".ts", ".json"];

/**
 * Walk the freshly copied package: drop anything that belongs to the template's
 * own install, and repoint every reference to `@repo/template` at the new name
 * so the generated package is self-consistent.
 */
const prepareCopy = (
  dir: string,
  from: string,
  to: string,
): Effect.Effect<void, FileSystemFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const entries = yield* fs.readDirectory(dir).pipe(fileSystemFailure("read", dir));
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (PRUNE.includes(entry)) {
        yield* fs
          .remove(full, { recursive: true, force: true })
          .pipe(fileSystemFailure("remove", full));
        continue;
      }
      const info = yield* fs.stat(full).pipe(fileSystemFailure("stat", full));
      if (info.type === "Directory") {
        yield* prepareCopy(full, from, to);
        continue;
      }
      if (!REWRITE_EXTENSIONS.some((extension) => full.endsWith(extension))) {
        continue;
      }
      const contents = yield* fs.readFileString(full).pipe(fileSystemFailure("read", full));
      if (contents.includes(from)) {
        yield* fs
          .writeFileString(full, contents.replaceAll(from, to))
          .pipe(fileSystemFailure("write", full));
      }
    }
  });

/**
 * Repoint a tsconfig's relative `extends` after moving it from `fromDir` to
 * `toDir`. A template is a workspace member, so its `extends` must resolve
 * where the template sits, and its copy lands at a different depth.
 * A string splice rather than a JSON round-trip keeps JSONC comments intact.
 */
export const retargetExtends = (
  contents: string,
  fromDir: string,
  toDir: string,
  path: Pick<Path.Path, "relative" | "resolve">,
): string =>
  contents.replace(/("extends"\s*:\s*")(\.{1,2}\/[^"]*)"/, (_, prefix: string, from: string) => {
    const relative = path.relative(toDir, path.resolve(fromDir, from));
    return `${prefix}${relative.startsWith(".") ? relative : `./${relative}`}"`;
  });

export interface CreatePackageResult {
  readonly packageName: string;
  readonly packagePath: RepoPath;
  /** Files written as JSON, for the caller to format. */
  readonly written: ReadonlyArray<RepoPath>;
}

export interface RemovePackageResult extends CreatePackageResult {
  /** A public package may also be on npm, which removing it here leaves untouched. */
  readonly wasPublic: boolean;
}

/**
 * Copy a template to `packages/<name>`. A public package is then made public
 * exactly as `pkg make-public` would, so both paths share one implementation.
 */
export const createPackage = Effect.fnUntraced(function* (
  root: string,
  name: PackageName,
  templateName: string,
  visibility: Visibility,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const template = path.join(templatesDir(path), templateName);
  const packagePath = RepoPath.make(path.join(PACKAGES_DIR, name));
  const target = path.join(root, packagePath);

  const templateManifest = path.join(template, "package.json");
  if (!(yield* fs.exists(templateManifest).pipe(fileSystemFailure("stat", templateManifest)))) {
    return yield* new UnknownTemplate({
      template: templateName,
      available: yield* listTemplates(),
    });
  }
  if (yield* fs.exists(target).pipe(fileSystemFailure("stat", packagePath))) {
    return yield* new AlreadyExists({ dir: packagePath });
  }
  if (visibility === "public") {
    yield* ensureNpmScope(root);
  }

  // The template's own package name is the string to repoint, so templates are
  // free to name themselves anything without the CLI knowing about it.
  const text = yield* fs
    .readFileString(templateManifest)
    .pipe(fileSystemFailure("read", templateManifest));
  const templatePackageName = (yield* decodeText(text, templateManifest)).manifest.name;
  if (templatePackageName === undefined) {
    return yield* new MissingName({ path: templateManifest });
  }

  yield* fs.copy(template, target).pipe(fileSystemFailure("copy", template));

  const packageName = `@repo/${name}`;
  yield* prepareCopy(target, templatePackageName, packageName);

  const tsconfigPath = path.join(target, "tsconfig.json");
  if (yield* fs.exists(tsconfigPath).pipe(fileSystemFailure("stat", tsconfigPath))) {
    const tsconfig = yield* fs
      .readFileString(tsconfigPath)
      .pipe(fileSystemFailure("read", tsconfigPath));
    yield* fs
      .writeFileString(tsconfigPath, retargetExtends(tsconfig, template, target, path))
      .pipe(fileSystemFailure("write", tsconfigPath));
  }

  if (visibility === "public") {
    const { to, written } = yield* makePublic(root, name);
    return { packageName: to, packagePath, written } satisfies CreatePackageResult;
  }
  return { packageName, packagePath, written: [] } satisfies CreatePackageResult;
});

/**
 * Everything `pkg rm` refuses on, checked without deleting anything, so the CLI
 * can refuse before it asks for confirmation: a protected name, a package that
 * is not a workspace member, or a member that still depends on it.
 */
export const checkRemovable = Effect.fnUntraced(function* (root: string, name: PackageName) {
  const path = yield* Path.Path;
  const packagePath = RepoPath.make(path.join(PACKAGES_DIR, name));

  if (PROTECTED_PACKAGES.includes(name)) {
    return yield* new ProtectedPackage({ dir: packagePath });
  }

  const snapshot = yield* loadWorkspace(root);
  const target = snapshot.members.find((member) => member.dir === packagePath);
  if (target === undefined) {
    return yield* new PackageNotFound({ dir: packagePath });
  }
  const packageName = target.manifest.name ?? `@repo/${name}`;

  const dependents = dependentsOf(snapshot, packageName, path);
  if (dependents.length > 0) {
    return yield* new HasDependents({ packageName, dependents });
  }

  return { packageName, packagePath, wasPublic: target.manifest.private !== true };
});

/**
 * The reverse of `createPackage`: delete the directory once `checkRemovable`
 * passes, then sync. Nothing here prompts — the CLI owns confirmation.
 */
export const removePackage = Effect.fnUntraced(function* (root: string, name: PackageName) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { packageName, packagePath, wasPublic } = yield* checkRemovable(root, name);

  yield* fs
    .remove(path.join(root, packagePath), { recursive: true, force: true })
    .pipe(fileSystemFailure("remove", packagePath));

  const { written } = yield* syncWorkspace(root, { check: false });
  return { packageName, packagePath, written, wasPublic } satisfies RemovePackageResult;
});
