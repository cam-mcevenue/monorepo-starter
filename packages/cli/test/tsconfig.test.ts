import { expect, it } from "@effect/vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { retargetExtends } from "@repo/cli/internal/tsconfig";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const base = path.join(repoRoot, "tsconfig.base.json");
const templatesDir = path.join(repoRoot, "packages/cli/templates");
const templates = fs
  .readdirSync(templatesDir)
  .filter((entry) => fs.existsSync(path.join(templatesDir, entry, "tsconfig.json")));

const extendsOf = (tsconfig: string) => /"extends"\s*:\s*"([^"]+)"/.exec(tsconfig)?.[1] ?? "";

/**
 * A template is a workspace member, so its `extends` must resolve where it
 * sits, and `pkg add` must repoint it for the copy at `packages/<name>`.
 */
it.each(templates)("template %s extends the root base, in place and once copied", (template) => {
  const templateDir = path.join(templatesDir, template);
  const tsconfig = fs.readFileSync(path.join(templateDir, "tsconfig.json"), "utf8");
  expect(path.resolve(templateDir, extendsOf(tsconfig))).toBe(base);

  const destination = path.join(repoRoot, "packages", "example");
  const copied = retargetExtends(tsconfig, templateDir, destination, path);
  expect(extendsOf(copied)).toBe("../../tsconfig.base.json");
  expect(path.resolve(destination, extendsOf(copied))).toBe(base);
});

it("leaves comments and a package-specifier extends untouched", () => {
  const tsconfig = `{\n  // keep me\n  "extends": "@scope/config/base.json"\n}\n`;
  expect(retargetExtends(tsconfig, "/a/b/c", "/a/b", path)).toBe(tsconfig);
});
