import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import * as Toolchain from "@repo/cli/Toolchain";
import * as Workspace from "@repo/cli/Workspace";

/**
 * The one test on the real toolchain: `pnpm ls` resolving the workspace
 * globs, and `vp fmt` over what sync writes. The root is reached through a
 * symlink, since macOS's /tmp is one and pnpm ls reports real paths.
 */

layer(NodeServices.layer)("Toolchain", (it) => {
  it.effect("syncs a workspace opened through a symlink, then finds nothing to do", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const real = yield* fs.makeTempDirectoryScoped({ prefix: "cli-toolchain-" });
      const files: Record<string, string> = {
        "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
        "package.json": JSON.stringify({
          name: "monorepo",
          private: true,
          monorepoSettings: { npmScope: "@acme" },
        }),
        "packages/foo/package.json": JSON.stringify({
          name: "@acme/foo",
          exports: { ".": "./src/index.ts" },
        }),
      };
      for (const [file, contents] of Object.entries(files)) {
        yield* fs.makeDirectory(path.dirname(path.join(real, file)), { recursive: true });
        yield* fs.writeFileString(path.join(real, file), contents);
      }
      const link = `${real}-link`;
      yield* fs.symlink(real, link);
      yield* Effect.addFinalizer(() => fs.remove(link).pipe(Effect.ignore));

      const workspace = Workspace.layerAt(link).pipe(Layer.provide(Toolchain.layer));
      yield* Effect.gen(function* () {
        const service = yield* Workspace.Workspace;
        expect(yield* service.removablePackages).toEqual(["foo"]);
        const written = yield* service.apply(yield* service.planSync);
        // Absolute under the real root, though the workspace was opened through the link.
        expect(written).toEqual([
          path.join(yield* fs.realPath(real), "packages/foo/package.json"),
          path.join(yield* fs.realPath(real), "packages/foo/tsconfig.build.json"),
        ]);
        expect(service.root).toBe(yield* fs.realPath(real));
        expect((yield* service.planSync).findings).toEqual([]);
      }).pipe(Effect.provide(workspace));
    }),
  );
});
