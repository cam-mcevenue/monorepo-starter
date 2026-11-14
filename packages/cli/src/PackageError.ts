import { Effect, Schema, type PlatformError } from "effect";
import { CliError } from "effect/cli";

/**
 * Every way a package operation can fail. Most are expected: the input or the
 * repo is wrong, and the user can fix it. Those carry `CliError.userMessage`,
 * so `Command.run` prints just the message and exits 1. `FileSystemFailure`,
 * `ProcessFailure` and `UnexpectedOutput` are not: something underneath broke,
 * so they keep their cause and print in full.
 */

/** The file that marks the workspace root. */
export const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** Shown wherever a name is rejected, at the prompt as well as after it. */
export const nameHint = 'use lowercase kebab-case, e.g. "my-package"';

export class InvalidName extends Schema.TaggedError<
  InvalidName,
  { readonly brand: unique symbol }
>()("InvalidName", {
  input: Schema.String,
}) {
  override get message() {
    return `"${this.input}" is not a valid package name — ${nameHint}`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

export class NoWorkspaceRoot extends Schema.TaggedError<
  NoWorkspaceRoot,
  { readonly brand: unique symbol }
>()("NoWorkspaceRoot", {
  start: Schema.String,
}) {
  override get message() {
    return `Could not find ${WORKSPACE_MARKER} in ${this.start} or any parent directory`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

export class UnknownTemplate extends Schema.TaggedError<
  UnknownTemplate,
  { readonly brand: unique symbol }
>()("UnknownTemplate", {
  template: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Unknown template "${this.template}". Available: ${this.available.join(", ")}`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

/** A prompt had nothing to offer, such as `pkg rm` in a repo with no packages. */
export class NothingToChoose extends Schema.TaggedError<
  NothingToChoose,
  { readonly brand: unique symbol }
>()("NothingToChoose", {
  what: Schema.String,
}) {
  override get message() {
    return `No ${this.what} found`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

export class ConflictingFlags extends Schema.TaggedError<
  ConflictingFlags,
  { readonly brand: unique symbol }
>()("ConflictingFlags", {
  flags: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Pass ${this.flags.join(" or ")}, not both`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

/** A prompt was needed but stdin is not a terminal, so the input must come as an argument. */
export class MissingInput extends Schema.TaggedError<
  MissingInput,
  { readonly brand: unique symbol }
>()("MissingInput", { flag: Schema.String }) {
  override get message() {
    return `stdin is not a terminal, so pass ${this.flag} instead of answering a prompt`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

export class PackageNotFound extends Schema.TaggedError<
  PackageNotFound,
  { readonly brand: unique symbol }
>()("PackageNotFound", {
  dir: Schema.String,
}) {
  override get message() {
    return `${this.dir} is not a workspace package`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

export class AlreadyExists extends Schema.TaggedError<
  AlreadyExists,
  { readonly brand: unique symbol }
>()("AlreadyExists", {
  dir: Schema.String,
}) {
  override get message() {
    return `${this.dir} already exists`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

/** The dev CLI itself: removing it with itself is never what you meant. */
export class ProtectedPackage extends Schema.TaggedError<
  ProtectedPackage,
  { readonly brand: unique symbol }
>()("ProtectedPackage", {
  dir: Schema.String,
}) {
  override get message() {
    return `${this.dir} is this CLI — delete it by hand if you really mean to`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

export class HasDependents extends Schema.TaggedError<
  HasDependents,
  { readonly brand: unique symbol }
>()("HasDependents", {
  packageName: Schema.String,
  /** Each as `<member>/package.json (<field>)`. */
  dependents: Schema.Array(Schema.String),
}) {
  override get message() {
    const list = this.dependents.map((dependent) => `  ${dependent}`).join("\n");
    return `${this.packageName} is still a dependency. Remove it from these first:\n${list}`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

export class ScopeUnset extends Schema.TaggedError<ScopeUnset, { readonly brand: unique symbol }>()(
  "ScopeUnset",
  {},
) {
  override get message() {
    return `Set the npm scope first: add "repo": { "npmScope": "@your-scope" } to the root package.json`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

export class AlreadyPublic extends Schema.TaggedError<
  AlreadyPublic,
  { readonly brand: unique symbol }
>()("AlreadyPublic", {
  dir: Schema.String,
}) {
  override get message() {
    return `${this.dir} is already public`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

export class DependsOnPrivate extends Schema.TaggedError<
  DependsOnPrivate,
  { readonly brand: unique symbol }
>()("DependsOnPrivate", {
  dir: Schema.String,
  dependencies: Schema.Array(Schema.String),
}) {
  override get message() {
    return `${this.dir} depends on private workspace packages, make them public first: ${this.dependencies.join(", ")}`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

export class MissingName extends Schema.TaggedError<
  MissingName,
  { readonly brand: unique symbol }
>()("MissingName", {
  path: Schema.String,
}) {
  override get message() {
    return `${this.path} has no "name" field`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

/** A manifest that is not JSON, or whose known fields have the wrong shape. */
export class InvalidManifest extends Schema.TaggedError<
  InvalidManifest,
  { readonly brand: unique symbol }
>()("InvalidManifest", {
  path: Schema.String,
  issue: Schema.String,
}) {
  override get message() {
    return `${this.path} is not a valid manifest: ${this.issue}`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

/** `pkg sync` found problems; the findings themselves are printed before this. */
export class OutOfSync extends Schema.TaggedError<OutOfSync, { readonly brand: unique symbol }>()(
  "OutOfSync",
  {
    count: Schema.Int,
  },
) {
  override get message() {
    return `pkg sync: ${this.count} problem${this.count === 1 ? "" : "s"} found`;
  }
  override get [CliError.userMessage]() {
    return this.message;
  }
}

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export class FileSystemFailure extends Schema.TaggedError<
  FileSystemFailure,
  { readonly brand: unique symbol }
>()("FileSystemFailure", {
  operation: Schema.String,
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Failed to ${this.operation} ${this.path}: ${describe(this.cause)}`;
  }
}

export class ProcessFailure extends Schema.TaggedError<
  ProcessFailure,
  { readonly brand: unique symbol }
>()("ProcessFailure", {
  command: Schema.String,
  exitCode: Schema.optional(Schema.Int),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return this.exitCode === undefined
      ? `Failed to run ${this.command}: ${describe(this.cause)}`
      : `${this.command} exited with ${this.exitCode}`;
  }
}

export class UnexpectedOutput extends Schema.TaggedError<
  UnexpectedOutput,
  { readonly brand: unique symbol }
>()("UnexpectedOutput", {
  command: Schema.String,
  output: Schema.String,
}) {
  override get message() {
    return `${this.command} printed unexpected output: ${this.output}`;
  }
}

/** Name a filesystem failure by what was being done, and to which path. */
export const fileSystemFailure =
  (operation: string, path: string) =>
  <A, R>(
    effect: Effect.Effect<A, PlatformError.PlatformError, R>,
  ): Effect.Effect<A, FileSystemFailure, R> =>
    Effect.mapError(effect, (cause) => new FileSystemFailure({ operation, path, cause }));

export * as PackageError from "./PackageError.ts";
