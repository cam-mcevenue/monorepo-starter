import { NodeServices } from "@effect/platform-node";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Layer } from "effect";
import { PackageName } from "@repo/cli/Model";
import { Toolchain } from "@repo/cli/Toolchain";
import { Workspace } from "@repo/cli/Workspace";

const name = (value: string) => PackageName.make(value);

/**
 * A throwaway workspace on disk, so these tests run the real `pnpm ls` and
 * real file writes. Keys are repo-relative paths, values file contents.
 */
const fixtureRoots: Array<string> = [];
afterAll(() => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const fixture = (files: Record<string, unknown>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-fixture-"));
  fixtureRoots.push(root);
  const all: Record<string, unknown> = {
    "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
    "package.json": { name: "monorepo", private: true, repo: { npmScope: "@acme" } },
    ...files,
  };
  for (const [file, contents] of Object.entries(all)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(
      full,
      typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`,
    );
  }
  return {
    root,
    read: (file: string) => fs.readFileSync(path.join(root, file), "utf8"),
    json: (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8")),
    exists: (file: string) => fs.existsSync(path.join(root, file)),
  };
};

/** Use the workspace service from inside a test effect. */
const withWorkspace = Effect.fnUntraced(function* <A, E>(
  use: (workspace: Workspace.Interface) => Effect.Effect<A, E>,
) {
  return yield* use(yield* Workspace.Service);
});

/** Run against the workspace at `root`, over the real toolchain. */
const run = <A, E>(root: string, effect: Effect.Effect<A, E, Workspace.Service>) =>
  effect.pipe(
    Effect.provide(
      Workspace.layerAt(root).pipe(
        Layer.provide(Toolchain.layer),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

const sync = Effect.fnUntraced(function* (check: boolean) {
  const workspace = yield* Workspace.Service;
  const plan = yield* workspace.planSync;
  return check
    ? { findings: plan.findings, written: [] }
    : { findings: plan.findings, written: yield* workspace.apply(plan) };
});

const makePublic = Effect.fnUntraced(function* (value: string) {
  const workspace = yield* Workspace.Service;
  const plan = yield* workspace.planMakePublic(name(value));
  yield* workspace.apply(plan);
  return plan;
});

const create = Effect.fnUntraced(function* (
  value: string,
  template: string,
  visibility: "public" | "private",
) {
  const workspace = yield* Workspace.Service;
  const plan = yield* workspace.planCreate(
    yield* workspace.template(template),
    name(value),
    visibility,
  );
  yield* workspace.apply(plan);
  return plan;
});

const planRemove = (value: string) =>
  withWorkspace((workspace) => workspace.planRemove(name(value)));

describe("syncWorkspace", () => {
  it.effect("check writes nothing; sync repairs; a second sync finds nothing", () =>
    Effect.gen(function* () {
      const repo = fixture({
        "packages/foo/package.json": {
          name: "@acme/foo",
          exports: { ".": "./src/index.ts" },
          dependencies: { "@acme/bar": "workspace:*" },
        },
        "packages/bar/package.json": { name: "@acme/bar" },
        "packages/bar/tsconfig.build.json": `{
  // keep me
  "extends": "./tsconfig.json",
  "references": []
}
`,
      });

      const checked = yield* run(repo.root, sync(true));
      expect(checked.findings.filter((f) => f.fixable).length).toBeGreaterThan(0);
      expect(checked.written).toEqual([]);
      expect(repo.exists("packages/foo/tsconfig.build.json")).toBe(false);

      const synced = yield* run(repo.root, sync(false));
      expect(synced.written).toContain("packages/foo/tsconfig.build.json");
      expect(repo.read("packages/foo/tsconfig.build.json")).toContain(
        '{ "path": "../bar/tsconfig.build.json" }',
      );
      expect(repo.read("packages/bar/tsconfig.build.json")).toContain("// keep me");
      expect(repo.json("packages/foo/package.json").publishConfig.exports["."]).toBe(
        "./dist/index.js",
      );

      const again = yield* run(repo.root, sync(true));
      expect(again.findings).toEqual([]);
    }),
  );
});

describe("loadWorkspace through a symlinked root", () => {
  // macOS's /tmp is a symlink to /private/tmp, and pnpm ls reports real paths.
  it.effect("relates members to the real root, so dirs stay repo-relative", () =>
    Effect.gen(function* () {
      const repo = fixture({ "packages/foo/package.json": { name: "@acme/foo" } });
      const link = `${repo.root}-link`;
      fs.symlinkSync(repo.root, link);
      fixtureRoots.push(link);

      const removable = yield* run(
        link,
        withWorkspace((workspace) => workspace.removablePackages),
      );
      expect(removable).toEqual(["foo"]);
    }),
  );
});

describe("makePublic", () => {
  it.effect("renames into the scope across the workspace, drops private, and syncs", () =>
    Effect.gen(function* () {
      const repo = fixture({
        "packages/foo/package.json": { name: "@repo/foo", private: true },
        "packages/foo/test/index.test.ts": 'import { x } from "@repo/foo";\n',
        "packages/foo-extra/package.json": { name: "@repo/foo-extra", private: true },
        "packages/app/package.json": {
          name: "@repo/app",
          private: true,
          dependencies: { "@repo/foo": "workspace:*", "@repo/foo-extra": "workspace:*" },
        },
        "packages/app/src/main.ts": 'import "@repo/foo/Thing";\nimport "@repo/foo-extra";\n',
      });

      const result = yield* run(repo.root, makePublic("foo"));

      expect(result).toMatchObject({ from: "@repo/foo", to: "@acme/foo" });
      const manifest = repo.json("packages/foo/package.json");
      expect(manifest.name).toBe("@acme/foo");
      expect(manifest.private).toBeUndefined();
      expect(manifest.publishConfig.access).toBe("public");
      expect(repo.exists("packages/foo/tsconfig.build.json")).toBe(true);
      expect(repo.read("packages/foo/test/index.test.ts")).toContain('from "@acme/foo"');
      expect(Object.keys(repo.json("packages/app/package.json").dependencies)).toEqual([
        "@acme/foo",
        "@repo/foo-extra",
      ]);
      expect(repo.read("packages/app/src/main.ts")).toBe(
        'import "@acme/foo/Thing";\nimport "@repo/foo-extra";\n',
      );
    }),
  );

  it.effect("refuses without a scope, and with private deps listed, changing nothing", () =>
    Effect.gen(function* () {
      const unscoped = fixture({
        "package.json": { name: "monorepo", private: true },
        "packages/foo/package.json": { name: "@repo/foo", private: true },
      });
      const noScope = yield* run(unscoped.root, Effect.flip(makePublic("foo")));
      expect(noScope.message).toContain('"repo": { "npmScope"');

      const withPrivateDeps = fixture({
        "packages/foo/package.json": {
          name: "@repo/foo",
          private: true,
          dependencies: { "@repo/a": "workspace:*" },
          peerDependencies: { "@repo/b": "workspace:*" },
        },
        "packages/a/package.json": { name: "@repo/a", private: true },
        "packages/b/package.json": { name: "@repo/b", private: true },
      });
      const blocked = yield* run(withPrivateDeps.root, Effect.flip(makePublic("foo")));
      expect(blocked.message).toContain("@repo/a, @repo/b");
      expect(withPrivateDeps.json("packages/foo/package.json").private).toBe(true);
    }),
  );
});

describe("removePackage", () => {
  it.effect("refuses while any member depends on it, listing each, then removes once free", () =>
    Effect.gen(function* () {
      const repo = fixture({
        "packages/foo/package.json": { name: "@acme/foo" },
        "packages/app/package.json": {
          name: "@repo/app",
          private: true,
          devDependencies: { "@acme/foo": "workspace:*" },
        },
        "packages/lib/package.json": {
          name: "@acme/lib",
          peerDependencies: { "@acme/foo": "workspace:*" },
        },
      });

      const checked = yield* Effect.flip(run(repo.root, planRemove("foo")));
      expect(checked.message).toContain("packages/app/package.json (devDependencies)");

      const refused = checked;
      expect(refused.message).toContain("packages/app/package.json (devDependencies)");
      expect(refused.message).toContain("packages/lib/package.json (peerDependencies)");
      expect(repo.exists("packages/foo/package.json")).toBe(true);

      const removed = yield* run(
        repo.root,
        Effect.gen(function* () {
          const plan = yield* planRemove("app");
          yield* withWorkspace((workspace) => workspace.apply(plan));
          return plan;
        }),
      );
      expect(removed.packageName).toBe("@repo/app");
      expect(repo.exists("packages/app")).toBe(false);
    }),
  );
});

describe("createPackage", () => {
  it.effect("public: scaffolds from the template, then makes it public in the scope", () =>
    Effect.gen(function* () {
      const repo = fixture({});
      const created = yield* run(repo.root, create("widget", "pkg-effect", "public"));

      expect(created.packageName).toBe("@acme/widget");
      const manifest = repo.json("packages/widget/package.json");
      expect(manifest.name).toBe("@acme/widget");
      expect(manifest.private).toBeUndefined();
      expect(manifest.publishConfig.exports["."]).toBe("./dist/index.js");
      expect(repo.exists("packages/widget/tsconfig.build.json")).toBe(true);
      expect(repo.read("packages/widget/test/index.test.ts")).toContain('from "@acme/widget"');
    }),
  );

  it.effect("public without a scope fails before copying, leaving nothing behind", () =>
    Effect.gen(function* () {
      const repo = fixture({ "package.json": { name: "monorepo", private: true } });
      const error = yield* run(repo.root, Effect.flip(create("widget", "pkg-effect", "public")));

      expect(error.message).toContain('"repo": { "npmScope"');
      expect(repo.exists("packages/widget")).toBe(false);
    }),
  );
});
