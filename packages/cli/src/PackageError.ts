import { Effect, Schema, type PlatformError } from "effect";
import { CliError } from "effect/cli";
import * as Message from "./internal/message.ts";

/**
 * Every way a package operation can fail. Most are expected: the input or the
 * repo is wrong, and the user can fix it. Those carry `CliError.userMessage`,
 * so `Command.run` prints just the message and exits 1; the CLI's formatter
 * renders their `text` instead, with the names in it emphasised on a terminal. `FileSystemFailure`, `ProcessFailure` and
 * `UnexpectedOutput` are not: something underneath broke, so they keep their
 * cause and print in full.
 *
 * Each expected error builds its text once, as `text`; `message` is that text
 * plain, for logs, tests and the user message.
 */

/** The file that marks the workspace root. */
export const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** Shown wherever a name is rejected, at the prompt as well as after it. */
export const nameHint = Message.msg`use lowercase kebab-case, e.g. ${Message.code("my-package")}`;

const scopeSetting = (scope: string) =>
  Message.msg`${Message.code(`"monorepoSettings": { "npmScope": "${scope}" }`)} in the root ${Message.code("package.json")}`;

export class InvalidName extends Schema.TaggedError<
  InvalidName,
  { readonly brand: unique symbol }
>()("InvalidName", {
  input: Schema.String,
}) {
  get text(): Message.Message {
    return Message.msg`${Message.code(this.input)} is not a valid package name — ${nameHint}`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

export class NoWorkspaceRoot extends Schema.TaggedError<
  NoWorkspaceRoot,
  { readonly brand: unique symbol }
>()("NoWorkspaceRoot", {
  start: Schema.String,
}) {
  get text(): Message.Message {
    return Message.msg`Could not find ${Message.code(WORKSPACE_MARKER)} in ${Message.code(this.start)} or any parent directory`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

export class UnknownTemplate extends Schema.TaggedError<
  UnknownTemplate,
  { readonly brand: unique symbol }
>()("UnknownTemplate", {
  template: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  get text(): Message.Message {
    return Message.msg`Unknown template ${Message.code(this.template)}. Available: ${Message.join(this.available.map(Message.code), ", ")}`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

/** A prompt had nothing to offer, such as `pkg rm` in a repo with no packages. */
export class NothingToChoose extends Schema.TaggedError<
  NothingToChoose,
  { readonly brand: unique symbol }
>()("NothingToChoose", {
  what: Schema.String,
}) {
  get text(): Message.Message {
    return Message.msg`No ${this.what} found`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

export class ConflictingFlags extends Schema.TaggedError<
  ConflictingFlags,
  { readonly brand: unique symbol }
>()("ConflictingFlags", { flags: Schema.Array(Schema.String) }) {
  get text(): Message.Message {
    return Message.msg`Pass ${Message.join(this.flags.map(Message.code), " or ")}, not both`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

/** A prompt was needed but stdin is not a terminal, so the input must come as an argument. */
export class MissingInput extends Schema.TaggedError<
  MissingInput,
  { readonly brand: unique symbol }
>()("MissingInput", {
  /** Any one of these answers the prompt. */
  flags: Schema.Array(Schema.String),
}) {
  get text(): Message.Message {
    return Message.msg`stdin is not a terminal, so pass ${Message.join(this.flags.map(Message.code), " or ")} instead of answering a prompt`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

export class PackageNotFound extends Schema.TaggedError<
  PackageNotFound,
  { readonly brand: unique symbol }
>()("PackageNotFound", {
  dir: Schema.String,
}) {
  get text(): Message.Message {
    return Message.msg`${Message.code(this.dir)} is not a workspace package`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

export class AlreadyExists extends Schema.TaggedError<
  AlreadyExists,
  { readonly brand: unique symbol }
>()("AlreadyExists", {
  dir: Schema.String,
}) {
  get text(): Message.Message {
    return Message.msg`${Message.code(this.dir)} already exists`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

/** The dev CLI itself: removing it with itself is never what you meant. */
export class ProtectedPackage extends Schema.TaggedError<
  ProtectedPackage,
  { readonly brand: unique symbol }
>()("ProtectedPackage", { dir: Schema.String }) {
  get text(): Message.Message {
    return Message.msg`${Message.code(this.dir)} is this CLI — delete it by hand if you really mean to`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
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
  get text(): Message.Message {
    const list = Message.join(
      this.dependents.map((dependent) => Message.msg`  ${Message.code(dependent)}`),
      "\n",
    );
    return Message.msg`${Message.code(this.packageName)} is still a dependency. Remove it from these first:\n${list}`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

export class ScopeUnset extends Schema.TaggedError<ScopeUnset, { readonly brand: unique symbol }>()(
  "ScopeUnset",
  {},
) {
  get text(): Message.Message {
    return Message.msg`Set the npm scope first: pass ${Message.code("--npm-scope @your-scope")}, or add ${scopeSetting("@your-scope")}`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

export class InvalidScope extends Schema.TaggedError<
  InvalidScope,
  { readonly brand: unique symbol }
>()("InvalidScope", { input: Schema.String }) {
  get text(): Message.Message {
    return Message.msg`${Message.code(this.input)} is not a valid npm scope — use a lowercase name such as ${Message.code("@your-org")}`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

/** `--npm-scope` names a different scope from the one the repo already has. */
export class ScopeMismatch extends Schema.TaggedError<
  ScopeMismatch,
  { readonly brand: unique symbol }
>()("ScopeMismatch", { configured: Schema.String, given: Schema.String }) {
  get text(): Message.Message {
    return Message.msg`This repo's npm scope is ${Message.code(this.configured)}, not ${Message.code(this.given)}: drop ${Message.code("--npm-scope")}, or change ${scopeSetting(this.configured)}`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

export class AlreadyPublic extends Schema.TaggedError<
  AlreadyPublic,
  { readonly brand: unique symbol }
>()("AlreadyPublic", {
  dir: Schema.String,
}) {
  get text(): Message.Message {
    return Message.msg`${Message.code(this.dir)} is already public`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

export class DependsOnPrivate extends Schema.TaggedError<
  DependsOnPrivate,
  { readonly brand: unique symbol }
>()("DependsOnPrivate", { dir: Schema.String, dependencies: Schema.Array(Schema.String) }) {
  get text(): Message.Message {
    return Message.msg`${Message.code(this.dir)} depends on private workspace packages, make them public first: ${Message.join(this.dependencies.map(Message.code), ", ")}`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

export class MissingName extends Schema.TaggedError<
  MissingName,
  { readonly brand: unique symbol }
>()("MissingName", {
  path: Schema.String,
}) {
  get text(): Message.Message {
    return Message.msg`${Message.code(this.path)} has no ${Message.code('"name"')} field`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
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
  get text(): Message.Message {
    return Message.msg`${Message.code(this.path)} is not a valid manifest: ${this.issue}`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
  }
}

/** `pkg sync` found problems; the findings themselves are printed before this. */
export class OutOfSync extends Schema.TaggedError<OutOfSync, { readonly brand: unique symbol }>()(
  "OutOfSync",
  {
    count: Schema.Int,
  },
) {
  get text(): Message.Message {
    return Message.msg`${Message.code("pkg sync")}: ${this.count} problem${this.count === 1 ? "" : "s"} found`;
  }
  override get message() {
    return Message.plain(this.text);
  }
  override get [CliError.userMessage]() {
    return Message.plain(this.text);
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
>()("UnexpectedOutput", { command: Schema.String, output: Schema.String }) {
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
