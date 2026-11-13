# TypeScript wiring

Four files, each with one job:

| File | Job |
| --- | --- |
| `packages/tsconfig/tsconfig.base.json` | the real settings, consumed as `@repo/tsconfig/base.json` |
| `tsconfig.workspace.json` | solution file, references every package |
| `tsconfig.tests.json` | type-checks sources and tests together |
| `tsconfig.json` | root solution, references the two above |

A package extends `@repo/tsconfig/base.json` and declares `@repo/tsconfig` as a devDependency.
The specifier resolves identically at any depth, so a template four directories deep and a
generated package two directories deep share one line. Relative `../../` paths could not do
that, and the generator would have to rewrite them on copy.

`tsconfig.base.json` uses `${configDir}` for `outDir` and `rootDir`, so each package emits to
its own `dist` and roots at its own `src` even though the settings arrive from `node_modules`.
Keep paths there written with `${configDir}`; a plain relative path resolves against the config
package instead.

## The tests project includes src

`tsconfig.tests.json` globs sources as well as tests:

```json
"./apps/*/src/**/*.ts",
"./packages/*/src/**/*.ts",
"./packages/cli/templates/*/src/**/*.ts",
```

A composite project must list every file it pulls in. Tests import from `src`, and those
imports resolve to TypeScript source rather than built declarations because nothing builds
here, so the sources have to be listed or `tsc` reports `TS6307`. The errors cascade, since a
source file's own imports then also need listing.

## Two coherent designs, and why this one

Effect's repo, where this config came from, lists **no** source globs. Instead
`tsconfig.tests.json` carries `references: [{ "path": "tsconfig.packages.json" }]` and `paths`
aliases mapping package names to source, and a comment in their `tsconfig.base.json` names the
mechanism: `"stripInternal": false, // tests require false because project references
type-check against those declarations`. Their tests project resolves imports to the referenced
projects' declarations, so source files never enter its program.

This repo does the opposite: no `references`, source globs instead. Both are self-consistent.
With the globs the sources are already in the tests project, so there is nothing for a
reference to redirect to.

Switching was attempted and is blocked at the runtime, not the typecheck. Measured, in order:

| Change | Result |
| --- | --- |
| Drop src globs, keep no `references` | `TS6307` on all three imports |
| Drop src globs, add `references` back | `TS6307` gone; `TS2878` on the one cross-project relative import |
| Also alias that import, `@repo/cli/*` → `src/*.ts`, as Effect does | `tsc -b` exits 0, `vpr check` clean |
| Run the tests | **fails**: `"./internal/scaffold" is not exported` from `packages/cli` |

The last row is the wall. A `paths` alias is a typecheck-only instruction. Vitest resolves the
same import through Node, which honours the package `exports` map, and that map blocks
`./internal/*` on purpose. Effect's `vitest.config.ts` declares no aliases, so they close this
gap some other way that is not visible from their config alone.

Adding `references` on its own is not an improvement either: it turns the clean `TS6307` into
`TS2878` on the relative import, so it only pays off bundled with the aliases that break the
runtime.

So the source globs stay. The cost is that each source file is type-checked in its own project
and again in the tests project, which is invisible at this size. The thing to find out before
trying again is how Effect's tests load internals at runtime.

## Project references

A package is type-checked only when `tsconfig.workspace.json` references it. `vpr cli pkg add`
inserts the entry with a string splice rather than a JSON round-trip, because that file is
JSONC and re-serialising it deletes its comments.

The `extends` in `tsconfig.workspace.json` is inert. That file has `include: []` and only
`references`, so it compiles nothing and the settings it inherits govern nothing. Point it at a
file that does not exist and `vpr check`, `vpr test` and `tsc -b` all still pass, measured with
both a relative path and a package specifier. Nothing in the repo catches a typo there, so read
that line carefully when you touch it.
