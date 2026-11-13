import { Data, Effect, FileSystem, Path, type PlatformError } from "effect";

/**
 * Internal implementation of `pkg add` and `pkg rm`. The command module owns
 * the CLI surface; this module owns the filesystem work.
 */

export class ScaffoldError extends Data.TaggedError("ScaffoldError")<{
  readonly message: string;
}> {}

/** Collapse a filesystem failure into a `ScaffoldError` with context. */
const orFail = <A>(
  effect: Effect.Effect<A, PlatformError.PlatformError>,
  message: string,
): Effect.Effect<A, ScaffoldError> =>
  effect.pipe(
    Effect.mapError((cause) => new ScaffoldError({ message: `${message}: ${cause.message}` })),
  );

const PACKAGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PACKAGES_DIR = "packages";

/**
 * Templates ship alongside the CLI, so resolve them from this file rather than
 * from the repo root. That keeps the two together wherever the CLI is run from.
 */
const templatesDir = (path: Path.Path) => path.resolve(import.meta.dirname, "../../templates");

/** The dev CLI itself — removing it with itself is never what you meant. */
const PROTECTED_PACKAGES = ["cli"];
const WORKSPACE_TSCONFIG = "tsconfig.workspace.json";
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/**
 * Walk up from `start` until the workspace root is found, so the command works
 * from any directory in the repo.
 */
export const findRepoRoot = (
  start: string,
): Effect.Effect<string, ScaffoldError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    let current = path.resolve(start);
    for (;;) {
      const marker = path.join(current, WORKSPACE_MARKER);
      if (yield* orFail(fs.exists(marker), `Failed to stat ${marker}`)) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return yield* new ScaffoldError({
          message: `Could not find ${WORKSPACE_MARKER} in ${start} or any parent directory`,
        });
      }
      current = parent;
    }
  });

/**
 * Insert a project reference into `tsconfig.workspace.json` with a string
 * splice rather than a JSON round-trip, because that file is JSONC — parsing
 * and re-serialising it would silently delete its comments.
 */
export const addProjectReference = (
  contents: string,
  packagePath: string,
): Effect.Effect<string, ScaffoldError> =>
  Effect.gen(function* () {
    const marker = '"references": [';
    const index = contents.indexOf(marker);
    if (index === -1) {
      return yield* new ScaffoldError({
        message: `Could not find a "references" array in ${WORKSPACE_TSCONFIG}`,
      });
    }
    const insertAt = index + marker.length;
    return `${contents.slice(0, insertAt)}\n    { "path": "${packagePath}" },${contents.slice(insertAt)}`;
  });

/** Drop a project reference from `tsconfig.workspace.json`, comments intact. */
export const removeProjectReference = (
  contents: string,
  packagePath: string,
): Effect.Effect<string, ScaffoldError> =>
  Effect.gen(function* () {
    const entry = `{ "path": "${packagePath}" }`;
    const index = contents.indexOf(entry);
    if (index === -1) {
      return yield* new ScaffoldError({
        message: `No reference to ${packagePath} in ${WORKSPACE_TSCONFIG}`,
      });
    }
    // Take the whole line, including its leading newline and any trailing comma.
    // tsconfig allows trailing commas, so removing the last entry stays valid.
    const lineStart = contents.lastIndexOf("\n", index);
    const afterEntry = index + entry.length;
    const lineEnd = contents[afterEntry] === "," ? afterEntry + 1 : afterEntry;
    return contents.slice(0, lineStart) + contents.slice(lineEnd);
  });

/** Directory names under `full` that contain a `package.json`, sorted. */
const listPackageDirs = Effect.fnUntraced(function* (full: string, label: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  if (!(yield* orFail(fs.exists(full), `Failed to stat ${label}`))) {
    return [] as Array<string>;
  }
  const entries = yield* orFail(fs.readDirectory(full), `Failed to read ${label}`);

  const found: Array<string> = [];
  for (const entry of [...entries].sort()) {
    const manifest = path.join(full, entry, "package.json");
    if (yield* orFail(fs.exists(manifest), `Failed to stat ${manifest}`)) {
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
  return yield* listPackageDirs(templatesDir(path), "the templates directory");
});

/** Every directory in `packages/` that looks like a package. */
export const listPackages = Effect.fnUntraced(function* (root: string) {
  const path = yield* Path.Path;
  return yield* listPackageDirs(path.join(root, PACKAGES_DIR), PACKAGES_DIR);
});

/** Packages that `pkg rm` is allowed to delete — never offer the CLI itself. */
export const listRemovablePackages = (root: string) =>
  Effect.map(listPackages(root), (packages) =>
    packages.filter((name) => !PROTECTED_PACKAGES.includes(name)),
  );

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
): Effect.Effect<void, ScaffoldError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const entries = yield* orFail(fs.readDirectory(dir), `Failed to read ${dir}`);
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (PRUNE.includes(entry)) {
        yield* orFail(
          fs.remove(full, { recursive: true, force: true }),
          `Failed to remove ${full}`,
        );
        continue;
      }
      const info = yield* orFail(fs.stat(full), `Failed to stat ${full}`);
      if (info.type === "Directory") {
        yield* prepareCopy(full, from, to);
        continue;
      }
      if (!REWRITE_EXTENSIONS.some((extension) => full.endsWith(extension))) {
        continue;
      }
      const contents = yield* orFail(fs.readFileString(full), `Failed to read ${full}`);
      if (contents.includes(from)) {
        yield* orFail(
          fs.writeFileString(full, contents.replaceAll(from, to)),
          `Failed to write ${full}`,
        );
      }
    }
  });

export interface CreatePackageResult {
  readonly packageName: string;
  readonly packagePath: string;
}

/** Shared so the CLI can reject a bad name at the prompt as well as after it. */
export const nameHint = 'use lowercase kebab-case, e.g. "my-package"';

export const validateName = (name: string): Effect.Effect<string, ScaffoldError> =>
  PACKAGE_NAME.test(name)
    ? Effect.succeed(name)
    : Effect.fail(
        new ScaffoldError({ message: `"${name}" is not a valid package name — ${nameHint}` }),
      );

export const createPackage = (
  name: string,
  templateName: string,
): Effect.Effect<CreatePackageResult, ScaffoldError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* validateName(name);

    const root = yield* findRepoRoot(process.cwd());
    const template = path.join(templatesDir(path), templateName);
    const packagePath = `${PACKAGES_DIR}/${name}`;
    const target = path.join(root, packagePath);

    const templateManifest = path.join(template, "package.json");
    if (!(yield* orFail(fs.exists(templateManifest), `Failed to stat ${templateManifest}`))) {
      return yield* new ScaffoldError({ message: `No template named "${templateName}"` });
    }
    if (yield* orFail(fs.exists(target), `Failed to stat ${packagePath}`)) {
      return yield* new ScaffoldError({ message: `${packagePath} already exists` });
    }

    // The template's own package name is the string to repoint, so templates are
    // free to name themselves anything without the CLI knowing about it.
    const manifest = yield* orFail(
      fs.readFileString(templateManifest),
      `Failed to read ${templateManifest}`,
    );
    const templatePackageName = /"name"\s*:\s*"([^"]+)"/.exec(manifest)?.[1];
    if (templatePackageName === undefined) {
      return yield* new ScaffoldError({ message: `${templateManifest} has no "name" field` });
    }

    yield* orFail(fs.copy(template, target), `Failed to copy the ${templateName} template`);

    const packageName = `@repo/${name}`;
    yield* prepareCopy(target, templatePackageName, packageName);

    const tsconfigPath = path.join(root, WORKSPACE_TSCONFIG);
    const tsconfig = yield* orFail(
      fs.readFileString(tsconfigPath),
      `Failed to read ${WORKSPACE_TSCONFIG}`,
    );
    yield* orFail(
      fs.writeFileString(tsconfigPath, yield* addProjectReference(tsconfig, packagePath)),
      `Failed to write ${WORKSPACE_TSCONFIG}`,
    );

    return { packageName, packagePath };
  });

/**
 * The reverse of `createPackage`: delete the directory and drop its project
 * reference. Nothing here prompts — the CLI owns confirmation.
 */
export const removePackage = (
  name: string,
): Effect.Effect<CreatePackageResult, ScaffoldError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* validateName(name);

    if (PROTECTED_PACKAGES.includes(name)) {
      return yield* new ScaffoldError({
        message: `${PACKAGES_DIR}/${name} is this CLI — delete it by hand if you really mean to`,
      });
    }

    const root = yield* findRepoRoot(process.cwd());
    const packagePath = `${PACKAGES_DIR}/${name}`;
    const target = path.join(root, packagePath);

    if (!(yield* orFail(fs.exists(target), `Failed to stat ${packagePath}`))) {
      return yield* new ScaffoldError({ message: `${packagePath} does not exist` });
    }

    const manifestPath = path.join(target, "package.json");
    const manifest = yield* orFail(
      fs.readFileString(manifestPath),
      `Failed to read ${manifestPath}`,
    );
    const packageName = /"name"\s*:\s*"([^"]+)"/.exec(manifest)?.[1] ?? `@repo/${name}`;

    yield* orFail(
      fs.remove(target, { recursive: true, force: true }),
      `Failed to remove ${packagePath}`,
    );

    const tsconfigPath = path.join(root, WORKSPACE_TSCONFIG);
    const tsconfig = yield* orFail(
      fs.readFileString(tsconfigPath),
      `Failed to read ${WORKSPACE_TSCONFIG}`,
    );
    yield* orFail(
      fs.writeFileString(tsconfigPath, yield* removeProjectReference(tsconfig, packagePath)),
      `Failed to write ${WORKSPACE_TSCONFIG}`,
    );

    return { packageName, packagePath };
  });
