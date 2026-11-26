# Packages

## Adding a package

A directory becomes a package when a `pnpm-workspace.yaml` glob matches it and its `tsconfig.json` `extends` reaches the root base. Nothing else registers it: the typecheck finds each file's nearest `tsconfig.json`.

Create, remove and publish packages through the repo's dev CLI when it has one: look under `run.tasks` in `vite.config.ts`, then read its `--help`. It does wiring a hand-built package misses.

## The package boundary

What counts as a public or internal module is in [`MODULES.md`](./MODULES.md). This is how a workspace package enforces the split.

Adding a file to `src/` publishes a new entry point, so `src/` is an API decision, not a file-organisation one.

### The exports map

The `exports` map enforces the split, not convention:

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

`@repo/pkg/internal/thing` and `@repo/pkg/index` fail to resolve. The `null` entries win over `./*` because a longer literal prefix beats a wildcard, so the block holds in any order. Tests get no way around it; see [`TSCONFIG.md`](./TSCONFIG.md).

### The boundary guard

Each package's tests carry a type-only guard that the block still works:

```ts
// @ts-expect-error internals are not importable across the package boundary
export type BoundaryGuard = typeof import("@repo/pkg/internal/format");
```

If `exports` stops blocking internals, the suppression goes unused and the typecheck fails with `TS2578`. It is type-only so nothing resolves at runtime, and exported so `noUnusedLocals` leaves it alone.

Renaming `src/internal` means renaming the `"./internal/*": null` entry in the same commit: miss it and `./*` matches the new directory, every internal becomes public, and only the guard notices.

### Scope

Private workspace packages use a constant scope such as `@repo/*` rather than the project name, so a scaffolded repo renames nothing and no import is ever half-renamed. A published package moves to the repo's npm scope.
