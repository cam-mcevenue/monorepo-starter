import type { Path } from "effect";

/**
 * Text edits to tsconfig files. Each is a splice rather than a JSON round-trip,
 * so JSONC comments elsewhere in the file survive.
 */

export const BUILD_CONFIG = "tsconfig.build.json";

/** A relative path as written into a config file: `/` between segments on every platform. */
export const toPosix = (path: Pick<Path.Path, "sep">, relative: string) =>
  relative.split(path.sep).join("/");

const REFERENCES = /"references"\s*:\s*\[[^\]]*\]/;

/** The `path` of each entry in `references`, or `undefined` when there is no array. */
export const referencesIn = (buildConfig: string): ReadonlyArray<string> | undefined => {
  const match = REFERENCES.exec(buildConfig);
  return match === null
    ? undefined
    : [...match[0].matchAll(/"path"\s*:\s*"([^"]+)"/g)].map((entry) => entry[1] ?? "");
};

const renderReferences = (paths: ReadonlyArray<string>) =>
  paths.length === 0
    ? `"references": []`
    : `"references": [\n${paths.map((p) => `    { "path": "${p}" }`).join(",\n")}\n  ]`;

/** Replace only the `references` array. A config without one gets it as its first property. */
export const spliceReferences = (buildConfig: string, paths: ReadonlyArray<string>) =>
  REFERENCES.test(buildConfig)
    ? buildConfig.replace(REFERENCES, renderReferences(paths))
    : buildConfig.replace("{", `{\n  ${renderReferences(paths)},`);

/**
 * Repoint a tsconfig's relative `extends` after moving it from `fromDir` to
 * `toDir`. A template is a workspace member, so its `extends` must resolve
 * where the template sits, and its copy lands at a different depth.
 */
export const retargetExtends = (
  contents: string,
  fromDir: string,
  toDir: string,
  path: Pick<Path.Path, "relative" | "resolve" | "sep">,
): string =>
  contents.replace(/("extends"\s*:\s*")(\.{1,2}\/[^"]*)"/, (_, prefix: string, from: string) => {
    const relative = toPosix(path, path.relative(toDir, path.resolve(fromDir, from)));
    return `${prefix}${relative.startsWith(".") ? relative : `./${relative}`}"`;
  });
