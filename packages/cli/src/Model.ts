import { Effect, Schema } from "effect";
import * as PackageError from "./PackageError.ts";

/** A package's directory name under `packages/`: lowercase kebab-case, no scope. */
export const PackageName = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  Schema.brand("PackageName"),
);
export type PackageName = typeof PackageName.Type;

/** Trimmed first, so an argument and a prompt answer accept the same input. */
export const decodePackageName = (
  input: string,
): Effect.Effect<PackageName, PackageError.InvalidName> =>
  Schema.decodeEffect(PackageName)(input.trim()).pipe(
    Effect.mapError(() => new PackageError.InvalidName({ input })),
  );

/** The npm scope public packages publish under, `@` included. */
export const NpmScope = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^@[a-z0-9][a-z0-9._~-]*$/)),
  Schema.brand("NpmScope"),
);
export type NpmScope = typeof NpmScope.Type;

/** Trimmed, with the `@` added when it was left off, then validated. */
export const decodeNpmScope = (
  input: string,
): Effect.Effect<NpmScope, PackageError.InvalidScope> => {
  const trimmed = input.trim();
  return Schema.decodeEffect(NpmScope)(trimmed.startsWith("@") ? trimmed : `@${trimmed}`).pipe(
    Effect.mapError(() => new PackageError.InvalidScope({ input })),
  );
};

export type Visibility = "public" | "private";
