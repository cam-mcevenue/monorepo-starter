# TypeScript wiring

Check configs and build configs are separate. Every project has a check config. Only a published
package also has a build config.

| File | Job |
| --- | --- |
| `tsconfig.base.json` | rules only: strictness, module resolution, `noEmit: true`, `types: []` |
| `tsconfig.effect.json` | the Effect language-service plugin entry, extended by the base |
| `tsconfig.json` (root) | root-level files such as `vite.config.ts` |
| `<project>/tsconfig.json` | that project's `src` and `test`, for the editor and `vpr check` |
| `<package>/tsconfig.build.json` | publishable packages only: switches emit on, see below |

There is no solution file and no root tests project. `vpr check` type-checks each file against
its nearest `tsconfig.json`, which was measured: a type error planted in each project's `src`
and `test` and in `vite.config.ts` was reported in every one, and `process` failed in a
project without `types: ["node"]` while passing in one with it.

## Extending the base

A project extends the base by relative path, `"extends": "../../tsconfig.base.json"` from
`packages/<name>`. A wrong depth fails loudly: `vpr check` reports `typescript(tsconfig-error)`
naming the file it could not read, and `vpr test` fails the transform with `TSCONFIG_ERROR`.

Templates sit four levels deep and their copies land two deep, so a template's `extends` is
written for where the template sits (`../../../../`), and `pkg add` repoints the copy with
`retargetExtends` in `packages/cli/src/internal/scaffold.ts`. The scaffold test asserts both
resolve to the root base.

`types: []` in the base means no `@types/*` package is ambient. A project opts in with
`"types": ["node"]`, so a browser app cannot pick up node globals by accident.

## Overriding the Effect plugin

A project's `plugins` entry merges with the base's entry key by key, so a package declares only
what it adds. Arrays inside the entry replace rather than merge: `packages/cli` listing its own
`allowedUnstableApis` dropped the base's `@effect/vitest`, measured as `unstable-api-usage`
warnings on every test. An override that sets an array repeats the base's items in it.

## Tests reaching internals

The `exports` map blocks `./internal/*`, so a test importing `@repo/cli/internal/scaffold` needs
two aliases, one per resolver:

- **Typecheck**: `paths` in the package's own `tsconfig.json`, `"@repo/cli/*": ["./src/*.ts"]`.
- **Runtime**: `resolve.alias` in the root `vite.config.ts`. Vitest resolves through the
  `exports` map and ignores `paths`, so without this the test fails with
  `"./internal/scaffold" is not exported`.

Add both halves together. Either alone passes one gate and fails the other.

## Build configs

A publishable package carries `tsconfig.build.json`, and nothing else does. Apps and
infrastructure are emitted by their deploy tooling. The CLI does not generate build configs
yet, so this section is the design to follow by hand:

```jsonc
{
  "extends": "./tsconfig.json",
  "include": ["src"],
  "compilerOptions": {
    "noEmit": false,
    "composite": true,
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "tsBuildInfoFile": "dist/tsconfig.build.tsbuildinfo"
  },
  "references": [{ "path": "../other/tsconfig.build.json" }]
}
```

It extends the package's own `tsconfig.json`, so the build sees the same `types` and plugin
settings as the editor, and only narrows `include` and switches emit on. The package builds
with `"build": "tsc -b tsconfig.build.json"`.

**References link build configs only, one per workspace dependency.** Exports point at source,
so building package A follows its import of package B into B's `.ts` files, which fall outside
A's `rootDir: src`. A reference to B's build config makes `tsc -b` build B first and read B's
`dist/*.d.ts` instead. Type-checking needs no references, because a check program may include
B's source freely. Every reference target must itself be publishable: npm consumers cannot
install a private workspace package.

**`tsBuildInfoFile` lives in `dist`.** `composite` turns on incremental builds, and the build
info records input hashes and outputs so `tsc -b` can skip unchanged work. Its default location
is derived from `outDir` relative to `rootDir`, which lands it in the package root. There it
outlives a deleted `dist` and can report a stale build as up to date. Inside `dist`, deleting
one deletes both.
