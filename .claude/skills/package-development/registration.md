# Package registration

A directory becomes a package when two things are true. `vpr cli pkg add` does both.

| Wiring | Where | Miss it and |
| --- | --- | --- |
| Workspace glob matches the directory | `pnpm-workspace.yaml` | no `node_modules`, no lockfile entry, `workspace:*` deps fail to resolve |
| `extends` reaches the root base | the package's `tsconfig.json` | `vpr check` fails with `typescript(tsconfig-error)` |

Nothing registers a package with the typecheck: `vpr check` finds each file's nearest
`tsconfig.json`, so a package is checked as soon as it has one.

## Renaming a package

The name appears in more places than the manifest:

1. `package.json` `name`.
2. Imports across the repo, including `workspace:*` dependents.
3. The boundary guard in the package's own test, which names its own package.
4. The `paths` alias in its `tsconfig.json` and the `resolve.alias` in the root
   `vite.config.ts`, if its tests reach internals.

Nothing renames the directory for you. A rename that changes both the name and the path is a
move as well, so follow the next section too.

## Moving a package

Changing a package's path touches:

1. The `pnpm-workspace.yaml` glob that matched the old path.
2. The relative `extends` in its `tsconfig.json`, if the depth changes.
3. The `references` in any `tsconfig.build.json` that points at it.
4. The `resolve.alias` path in the root `vite.config.ts`, if it has one.

Use `git mv` so history follows the files.

## Making a package publishable

Everything here runs from TypeScript source, so a package that leaves the workspace needs work
no internal package needs.

**It needs a real build.** Node refuses to strip types under `node_modules`, so a published
package whose `exports` point at `./src/*.ts` fails on install with
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Add a `tsconfig.build.json` and a
`"build": "tsc -b tsconfig.build.json"` script, as [`typescript.md`](./typescript.md) lays out.

**Its `exports` swap at publish time.** `exports` keeps pointing at `./src/*.ts` so the
workspace runs from source, and `publishConfig.exports` points consumers at `./dist/*.js`.

**It needs `files: ["dist", "src"]`.** Absent, the tarball ships whatever npm decides. `src`
rides along because `declarationMap` points go-to-definition at the source.

**Its workspace dependencies must be publishable too.** A consumer cannot install a private
workspace package, and each one is also a `references` entry in the build config.

**A scoped package needs `publishConfig.access: "public"`.** Scoped packages default to
private, and private scoped packages are a paid feature, so a bare `npm publish` fails with
`402 Payment Required`.

**Anything it must carry has to live inside its own directory.** A tarball cannot reach a
sibling. This is why `packages/cli/templates/` sits inside the CLI package rather than at the
repo root.
