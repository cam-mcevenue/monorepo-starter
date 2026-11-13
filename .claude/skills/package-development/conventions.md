# Package conventions

Internal packages use the `@repo/*` scope. The scope is a constant rather than the project
name, so a scaffolded repo renames nothing and no import is ever half-renamed.

## Inside a package

| Path | Holds |
| --- | --- |
| `src/` | public API. Every top-level module is importable as `@repo/pkg/ModuleName`. |
| `src/internal/` | implementation. Blocked at the package boundary. |
| `test/` | tests, sibling of `src/`, with fixtures in `test/fixtures/`. |

The boundary is enforced by the `exports` map, not by convention:

```json
"exports": {
  "./package.json": "./package.json",
  ".": "./src/index.ts",
  "./*": "./src/*.ts",
  "./internal/*": null,
  "./index": null,
  "./*/index": null
}
```

`@repo/pkg/internal/thing` and `@repo/pkg/index` fail to resolve. The `null` entries win over
`./*` because a longer literal prefix beats a wildcard, so the block holds regardless of
ordering.

Tests reach internals through the package name, `@repo/cli/internal/scaffold`, which needs a
typecheck alias and a runtime alias side by side. [`typescript.md`](./typescript.md) covers
the pair.

**Adding a file to `src/` publishes a new entry point.** So `src/` is an API decision, not a
file-organisation one. Anything not meant to be imported from outside starts life in
`src/internal/`.

## The boundary guard

The template's test carries a type-only assertion that the block still works:

```ts
// @ts-expect-error internals are not importable across the package boundary
export type BoundaryGuard = typeof import("@repo/pkg-effect/internal/greeting");
```

If the `exports` map ever stops blocking internals, that suppression becomes unused and
`vpr check` fails with `TS2578`. It is type-only so nothing resolves at runtime, and it is
exported so `noUnusedLocals` leaves it alone. Every generated package inherits it.

Renaming `src/internal` means renaming the `"./internal/*": null` entry in the same commit.
Miss it and `./*` matches the new directory, every internal becomes public, and nothing
errors. The guard is what catches that.

## Running from source

Inside the workspace nothing builds. `erasableSyntaxOnly` and
`rewriteRelativeImportExtensions` let Node execute the TypeScript directly, so `exports` points
at `./src/*.ts` and relative imports carry the `.ts` extension.

A package published to npm builds, because Node refuses to strip types under `node_modules`.
[`registration.md`](./registration.md) covers making one publishable.
