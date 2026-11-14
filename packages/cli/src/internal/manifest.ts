import { Effect, Schema } from "effect";
import { InvalidManifest } from "../PackageError.ts";

/**
 * `package.json` as the CLI sees it. A manifest is kept twice: `json` is the
 * exact contents, which merging and writing work on, and `Manifest` is the
 * decoded view of the fields the CLI reads. Decoding a struct drops unknown
 * keys and reorders the rest, so the view is never written back.
 */

const Dependencies = Schema.optional(Schema.Record(Schema.String, Schema.String));

export const Manifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
  dependencies: Dependencies,
  peerDependencies: Dependencies,
  devDependencies: Dependencies,
  publishConfig: Schema.optional(Schema.JsonObject),
  repo: Schema.optional(Schema.Struct({ npmScope: Schema.optional(Schema.String) })),
});
export interface Manifest extends Schema.Schema.Type<typeof Manifest> {}

/** `Schema.JsonObject`, restated: lint reads that name as the schema value and flags spreads. */
export interface JsonObject {
  readonly [key: string]: Schema.Json;
}

export interface Decoded {
  readonly json: JsonObject;
  readonly manifest: Manifest;
}

/** Decode a manifest already parsed, such as one built in a test or by a merge. */
export const decodeJson = (
  json: JsonObject,
  path: string,
): Effect.Effect<Decoded, InvalidManifest> =>
  Schema.decodeEffect(Manifest)(json).pipe(
    Effect.map((manifest) => ({ json, manifest })),
    Effect.mapError((error) => new InvalidManifest({ path, issue: error.message })),
  );

/** Decode `package.json` text, failing on bad JSON or a mistyped known field. */
export const decodeText = (text: string, path: string): Effect.Effect<Decoded, InvalidManifest> =>
  Schema.decodeEffect(Schema.fromJsonString(Schema.JsonObject))(text).pipe(
    Effect.mapError((error) => new InvalidManifest({ path, issue: error.message })),
    Effect.flatMap((json) => decodeJson(json, path)),
  );

export const isObject = (value: Schema.Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const serialize = (value: Schema.Json) => `${JSON.stringify(value, null, 2)}\n`;

export type DependencyField = "dependencies" | "peerDependencies" | "devDependencies";

/** Fields whose workspace entries the build needs: devDependencies only reach tests. */
export const BUILD_DEPENDENCY_FIELDS: ReadonlyArray<DependencyField> = [
  "dependencies",
  "peerDependencies",
];

export const ALL_DEPENDENCY_FIELDS: ReadonlyArray<DependencyField> = [
  "dependencies",
  "peerDependencies",
  "devDependencies",
];

export const dependencyNames = (manifest: Manifest, fields: ReadonlyArray<DependencyField>) =>
  fields.flatMap((field) => Object.keys(manifest[field] ?? {}));

/** `./src/X.ts` → `./dist/X.js`, recursing into condition objects. */
const toPublished = (target: Schema.Json): Schema.Json => {
  if (typeof target === "string") {
    return target.replace(/^\.\/src\//, "./dist/").replace(/\.ts$/, ".js");
  }
  if (isObject(target)) {
    return Object.fromEntries(
      Object.entries(target).map(([key, value]) => [key, toPublished(value)]),
    );
  }
  return target;
};

const MANIFEST_EXPORT = "./package.json";

/** Tools read a published manifest by name, so the export always leads the map. */
const withManifestExport = (exports: Schema.Json | undefined): JsonObject => {
  const map: JsonObject = isObject(exports) ? exports : {};
  return MANIFEST_EXPORT in map ? map : { [MANIFEST_EXPORT]: MANIFEST_EXPORT, ...map };
};

/**
 * Deep-merge the fragment into a manifest. Fragment values win, keys keep the
 * manifest's order with new ones appended, and `files` is a union so a package
 * can ship extras beyond the fragment's required entries.
 */
const mergeFragment = (target: JsonObject, fragment: JsonObject, atRoot: boolean): JsonObject => {
  const merged: Record<string, Schema.Json> = { ...target };
  for (const [key, value] of Object.entries(fragment)) {
    const existing = target[key];
    if (atRoot && key === "files" && Array.isArray(value)) {
      const current = Array.isArray(existing) ? existing : [];
      merged[key] = [...current, ...value.filter((entry) => !current.includes(entry))];
    } else if (isObject(value) && isObject(existing)) {
      merged[key] = mergeFragment(existing, value, false);
    } else {
      merged[key] = value;
    }
  }
  return merged;
};

/** Everything a public manifest must carry: the fragment, and exports mapped to dist. */
export const withPublishFields = (json: JsonObject, fragment: JsonObject): JsonObject => {
  const merged = mergeFragment(json, fragment, true);
  const exports = withManifestExport(merged["exports"]);
  const existing = merged["publishConfig"];
  const publishConfig: JsonObject = isObject(existing) ? existing : {};
  return {
    ...merged,
    exports,
    publishConfig: { ...publishConfig, exports: toPublished(exports) },
  };
};
