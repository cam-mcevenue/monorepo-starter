import { Effect, Schema } from "effect";
import { InvalidName } from "./PackageError.ts";

/** A package's directory name under `packages/`: lowercase kebab-case, no scope. */
export const PackageName = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  Schema.brand("PackageName"),
);
export type PackageName = typeof PackageName.Type;

/** Trimmed first, so an argument and a prompt answer accept the same input. */
export const decodePackageName = (input: string): Effect.Effect<PackageName, InvalidName> =>
  Schema.decodeEffect(PackageName)(input.trim()).pipe(
    Effect.mapError(() => new InvalidName({ input })),
  );

/**
 * A path relative to the repo root, `""` for the root itself. Absolute paths
 * stay plain strings, so the two cannot be mixed up in a list of written files.
 */
export const RepoPath = Schema.String.pipe(Schema.brand("RepoPath"));
export type RepoPath = typeof RepoPath.Type;

export type Visibility = "public" | "private";

export * as Model from "./Model.ts";
