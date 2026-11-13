import { Data, Effect, FileSystem, Path, type PlatformError } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import {
  dependentsOf,
  ensureNpmScope,
  loadWorkspace,
  makePublic,
  syncWorkspace,
  type WorkspaceError,
} from "./workspace.ts";

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
  readonly packagePath: string;
  /** Repo-relative files written as JSON, for the caller to format. */
  readonly written: ReadonlyArray<string>;
}

export interface RemovePackageResult extends CreatePackageResult {
  /** A public package may also be on npm, which removing it here leaves untouched. */
  readonly wasPublic: boolean;
}

export type Visibility = "public" | "private";

type Services = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner;

/** Shared so the CLI can reject a bad name at the prompt as well as after it. */
export const nameHint = 'use lowercase kebab-case, e.g. "my-package"';

export const validateName = (name: string): Effect.Effect<string, ScaffoldError> =>
  PACKAGE_NAME.test(name)
    ? Effect.succeed(name)
    : Effect.fail(
        new ScaffoldError({ message: `"${name}" is not a valid package name — ${nameHint}` }),
      );

/**
 * Copy a template to `packages/<name>`. A public package is then made public
 * exactly as `pkg make-public` would, so both paths share one implementation.
 */
export const createPackage = (
  root: string,
  name: string,
  templateName: string,
  visibility: Visibility,
): Effect.Effect<CreatePackageResult, ScaffoldError | WorkspaceError, Services> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* validateName(name);

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
    if (visibility === "public") {
      yield* ensureNpmScope(root);
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

    const tsconfigPath = path.join(target, "tsconfig.json");
    if (yield* orFail(fs.exists(tsconfigPath), `Failed to stat ${tsconfigPath}`)) {
      const tsconfig = yield* orFail(
        fs.readFileString(tsconfigPath),
        `Failed to read ${tsconfigPath}`,
      );
      yield* orFail(
        fs.writeFileString(tsconfigPath, retargetExtends(tsconfig, template, target, path)),
        `Failed to write ${tsconfigPath}`,
      );
    }

    if (visibility === "public") {
      const { to, written } = yield* makePublic(root, name);
      return { packageName: to, packagePath, written };
    }
    return { packageName, packagePath, written: [] };
  });

/**
 * The reverse of `createPackage`: delete the directory, refusing while any
 * workspace member still depends on it. Nothing here prompts — the CLI owns
 * confirmation.
 */
export const removePackage = (
  root: string,
  name: string,
): Effect.Effect<RemovePackageResult, ScaffoldError | WorkspaceError, Services> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* validateName(name);

    if (PROTECTED_PACKAGES.includes(name)) {
      return yield* new ScaffoldError({
        message: `${PACKAGES_DIR}/${name} is this CLI — delete it by hand if you really mean to`,
      });
    }

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

    const dependents = dependentsOf(yield* loadWorkspace(root), packageName, path);
    if (dependents.length > 0) {
      return yield* new ScaffoldError({
        message: `${packageName} is still a dependency. Remove it from these first:\n${dependents.map((d) => `  ${d}`).join("\n")}`,
      });
    }

    yield* orFail(
      fs.remove(target, { recursive: true, force: true }),
      `Failed to remove ${packagePath}`,
    );

    const { written } = yield* syncWorkspace(root, { check: false });
    const wasPublic = !/"private"\s*:\s*true/.test(manifest);
    return { packageName, packagePath, written, wasPublic };
  });
