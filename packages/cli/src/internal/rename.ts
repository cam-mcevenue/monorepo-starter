/**
 * Which files a package name is rewritten in, and how. Two walks use these: a
 * template copied into `packages/`, and `pkg make-public` across the workspace.
 */

/** Directories a workspace-wide rename never enters. */
export const WORKSPACE_PRUNE: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  ".git",
  "coverage",
]);
export const WORKSPACE_EXTENSIONS: ReadonlyArray<string> = [".ts", ".tsx", ".json"];

/** Directories never carried over from a template: they belong to its own install. */
export const TEMPLATE_PRUNE: ReadonlySet<string> = new Set(["node_modules", "dist"]);
export const TEMPLATE_EXTENSIONS: ReadonlyArray<string> = [".ts", ".json"];

export const hasExtension = (file: string, extensions: ReadonlyArray<string>) =>
  extensions.some((extension) => file.endsWith(extension));

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Not followed by a name character, so renaming @repo/foo leaves @repo/foo-extra alone. */
export const inText = (text: string, from: string, to: string) =>
  text.replace(new RegExp(`${escapeRegExp(from)}(?![\\w-])`, "g"), to);
