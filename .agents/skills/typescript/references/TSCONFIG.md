# tsconfig wiring

Check configs and build configs are separate. Every project has a check config; only a published package also has a build config.

| File | Job |
| --- | --- |
| `tsconfig.base.json` | rules only: strictness, module resolution, `noEmit: true`, `types: []` |
| `tsconfig.json` (root) | root-level files such as `vite.config.ts` |
| `<project>/tsconfig.json` | that project's `src` and `test`, for the editor and the check |
| `<package>/tsconfig.build.json` | publishable packages only: switches emit on |

There is no solution file and no root tests project. The check type-checks each file against its nearest `tsconfig.json`.

## Extending the base

A project extends the base by relative path: `"extends": "../../tsconfig.base.json"` from `packages/<name>`. A wrong depth fails loudly: the check reports `typescript(tsconfig-error)` naming the file it could not read, and the tests fail the transform with `TSCONFIG_ERROR`. A package copied by hand from a deeper template keeps the template's depth, which is the usual first break.

`types: []` in the base makes no `@types/*` package ambient. A project opts in with `"types": ["node"]`, so a browser app cannot pick up Node globals by accident.

## Running from source

Inside the workspace nothing builds. `erasableSyntaxOnly` and `rewriteRelativeImportExtensions` let Node execute the TypeScript directly, so `exports` points at `./src/*.ts` and relative imports carry the `.ts` extension.

A package published to npm builds, because Node refuses to strip types under `node_modules`.

## Tests import the public surface

A test imports a package the way a consumer does, by its name and public modules (`@repo/pkg`, `@repo/pkg/Plan`), so the `exports` map holds for tests too. A relative import into `src/` would step around the map, so the lint blocks it in test files (see [`TOOLCHAIN.md`](./TOOLCHAIN.md)). An internal module is tested through the public module that uses it. One that can't be tested that way is a public module waiting to be promoted (see [`MODULES.md`](./MODULES.md)).

So tests need no `paths` alias in `tsconfig.json` and no `resolve.alias` in `vite.config.ts`. A repo that still has them for tests: move those tests onto the public surface and delete both aliases in the same change, per **principle-migrate-callers-then-delete-legacy-apis**.

## Build configs

`tsconfig.build.json` extends the package's own `tsconfig.json`, so the build sees the same `types` and plugins as the editor, and only narrows `include` and switches emit on. Apps and infrastructure are emitted by their deploy tooling and carry none.

**References link build configs only.** One per public workspace package in `dependencies` or `peerDependencies`; `devDependencies` get none, since only tests import them. Exports point at source, so building package A follows its import of B into B's `.ts` files, outside A's `rootDir`. A reference to B's build config makes `tsc -b` build B first and read B's `dist/*.d.ts`. Type-checking needs no references, since a check program may include B's source.

**`tsBuildInfoFile` lives in `dist`.** Its default lands in the package root, where it outlives a deleted `dist` and can report a stale build as up to date. Inside `dist`, deleting one deletes both.
