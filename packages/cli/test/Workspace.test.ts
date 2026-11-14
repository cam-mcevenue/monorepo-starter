import { NodeServices } from "@effect/platform-node";
import { describe, expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import type { JsonObject } from "@repo/cli/internal/manifest";
import { PackageName, RepoPath } from "@repo/cli/Model";
import { Step } from "@repo/cli/Plan";
import { Toolchain } from "@repo/cli/Toolchain";
import { Workspace } from "@repo/cli/Workspace";

/**
 * The service against a real directory, with the toolchain faked: members are
 * every directory the fixture gives a `package.json`, as pnpm would list them
 * for a `packages/*` glob, and formatting records what it was asked to format.
 */

const fixture = Effect.fnUntraced(function* (files: Record<string, JsonObject | string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "cli-workspace-" });
  const all: Record<string, JsonObject | string> = {
    "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
    "package.json": { name: "monorepo", private: true, repo: { npmScope: "@acme" } },
    ...files,
  };
  for (const [file, contents] of Object.entries(all)) {
    const full = path.join(root, file);
    yield* fs.makeDirectory(path.dirname(full), { recursive: true });
    yield* fs.writeFileString(
      full,
      typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`,
    );
  }
  const memberDirs = Object.keys(all)
    .filter((file) => path.basename(file) === "package.json")
    .map((file) => path.dirname(file));
  return { root, memberDirs };
});

const fakeToolchain = (memberDirs: ReadonlyArray<string>, formatted: Array<string>) =>
  Layer.succeed(
    Toolchain.Service,
    Toolchain.Service.of({
      listMembers: (root) =>
        Effect.succeed(memberDirs.map((dir) => (dir === "." ? root : `${root}/${dir}`))),
      format: (_root, files) => Effect.sync(() => void formatted.push(...files)),
      install: () => Effect.void,
    }),
  );

/** Build a fixture and run `use` against a workspace rooted there. */
const inWorkspace = Effect.fnUntraced(function* <A, E, R>(
  files: Record<string, JsonObject | string>,
  use: (workspace: Workspace.Interface, root: string) => Effect.Effect<A, E, R>,
  formatted: Array<string> = [],
) {
  const { root, memberDirs } = yield* fixture(files);
  return yield* Effect.gen(function* () {
    return yield* use(yield* Workspace.Service, root);
  }).pipe(
    Effect.provide(
      Workspace.layerAt(root).pipe(Layer.provide(fakeToolchain(memberDirs, formatted))),
    ),
  );
});

const read = Effect.fnUntraced(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(`${root}/${file}`);
});

const exists = Effect.fnUntraced(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.exists(`${root}/${file}`);
});

layer(NodeServices.layer)("Workspace", (it) => {
  describe("planSync and apply", () => {
    it.effect("applies the plan, formats what it wrote, and a second plan is empty", () =>
      Effect.gen(function* () {
        const formatted: Array<string> = [];
        yield* inWorkspace(
          {
            "packages/foo/package.json": {
              name: "@acme/foo",
              exports: { ".": "./src/index.ts" },
              dependencies: { "@acme/bar": "workspace:*" },
            },
            "packages/bar/package.json": { name: "@acme/bar" },
            "packages/bar/tsconfig.build.json": `{\n  // keep me\n  "extends": "./tsconfig.json",\n  "references": []\n}\n`,
          },
          (workspace, root) =>
            Effect.gen(function* () {
              const written = yield* workspace.apply(yield* workspace.planSync);
              expect(written).toContain("packages/foo/tsconfig.build.json");
              expect(formatted).toEqual(written);
              expect(yield* read(root, "packages/foo/tsconfig.build.json")).toContain(
                '{ "path": "../bar/tsconfig.build.json" }',
              );
              expect(yield* read(root, "packages/bar/tsconfig.build.json")).toContain("// keep me");
              expect((yield* workspace.planSync).steps).toEqual([]);
            }),
          formatted,
        );
      }),
    );
  });

  describe("planCreate and apply", () => {
    it.effect("copies the real template, prunes its install, and writes the renamed copy", () =>
      inWorkspace({}, (workspace, root) =>
        Effect.gen(function* () {
          const template = yield* workspace.template("pkg-effect");
          const plan = yield* workspace.planCreate(template, PackageName.make("widget"), "public");
          yield* workspace.apply(plan);

          expect(plan.packageName).toBe("@acme/widget");
          const manifest = JSON.parse(yield* read(root, "packages/widget/package.json"));
          expect(manifest.name).toBe("@acme/widget");
          expect(manifest.publishConfig.exports["."]).toBe("./dist/index.js");
          expect(yield* exists(root, "packages/widget/node_modules")).toBe(false);
          expect(yield* exists(root, "packages/widget/tsconfig.build.json")).toBe(true);
          expect(yield* read(root, "packages/widget/test/Greeter.test.ts")).toContain(
            'from "@acme/widget"',
          );
          // The template's name is repointed wherever it appears, service ids included.
          expect(yield* read(root, "packages/widget/src/Greeter.ts")).toContain(
            '"@acme/widget/Greeter"',
          );
        }),
      ),
    );

    it.effect("refuses a directory that exists but is not a member", () =>
      Effect.gen(function* () {
        const error = yield* inWorkspace({ "packages/widget/notes.txt": "" }, (workspace) =>
          Effect.gen(function* () {
            const template = yield* workspace.template("pkg-effect");
            return yield* Effect.flip(
              workspace.planCreate(template, PackageName.make("widget"), "private"),
            );
          }),
        );
        expect(error._tag).toBe("AlreadyExists");
      }),
    );

    it.effect("refuses an unknown template, listing the ones there are", () =>
      Effect.gen(function* () {
        const error = yield* inWorkspace({}, (workspace) =>
          Effect.flip(workspace.template("nope")),
        );
        expect(error).toMatchObject({ _tag: "UnknownTemplate", template: "nope" });
        if (error._tag === "UnknownTemplate") {
          expect(error.available).toContain("pkg-effect");
        }
      }),
    );
  });

  describe("apply", () => {
    it.effect("removes a copied directory again when a later step fails", () =>
      Effect.gen(function* () {
        const formatted: Array<string> = [];
        yield* inWorkspace(
          { "seed/package.json": { name: "seed" } },
          (workspace, root) =>
            Effect.gen(function* () {
              const failure = yield* Effect.flip(
                workspace.apply({
                  steps: [
                    Step.Copy({ from: `${root}/seed`, to: RepoPath.make("packages/copy") }),
                    // A file where a directory is needed, so the write cannot succeed.
                    Step.Write({ path: RepoPath.make("seed/package.json/x"), contents: "" }),
                  ],
                  findings: [],
                }),
              );
              expect(failure._tag).toBe("FileSystemFailure");
              expect(yield* exists(root, "packages/copy")).toBe(false);
              expect(formatted).toEqual([]);
            }),
          formatted,
        );
      }),
    );
  });

  describe("planRemove and apply", () => {
    it.effect("deletes a package nothing depends on", () =>
      inWorkspace(
        { "packages/app/package.json": { name: "@repo/app", private: true } },
        (workspace, root) =>
          Effect.gen(function* () {
            yield* workspace.apply(yield* workspace.planRemove(PackageName.make("app")));
            expect(yield* exists(root, "packages/app")).toBe(false);
          }),
      ),
    );
  });

  describe("removablePackages and privatePackages", () => {
    it.effect("offer packages/<name> members, never the CLI", () =>
      Effect.gen(function* () {
        const [removable, publishable] = yield* inWorkspace(
          {
            "packages/cli/package.json": { name: "@repo/cli", private: true },
            "packages/b/package.json": { name: "@repo/b", private: true },
            "packages/a/package.json": { name: "@acme/a" },
          },
          (workspace) => Effect.all([workspace.removablePackages, workspace.privatePackages]),
        );
        expect(removable).toEqual(["a", "b"]);
        expect(publishable).toEqual(["b"]);
      }),
    );
  });
});
