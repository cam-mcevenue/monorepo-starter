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
3. Run `vpr cli pkg sync`, which rewrites any build `references` that pointed at the old path.
4. The `resolve.alias` path in the root `vite.config.ts`, if it has one.

Use `git mv` so history follows the files.

## Making a package publishable

```sh
vpr cli pkg add my-lib --public     # new package, public from the start
vpr cli pkg make-public my-lib      # an existing private package
vp install                          # relink the renamed package
```

Both need `"repo": { "npmScope": "@your-scope" }` in the root `package.json`, because nobody
owns `@repo` on npm. `make-public` renames the package into that scope across every `.ts` and
`.json` file in the workspace, drops `"private": true`, and runs `pkg sync`.

**Public means no `"private": true`.** That one field is the marker. `pkg sync` derives
everything else a public package carries, and `vpr check` runs `pkg sync --check`, so a public
package missing any of it fails the gate:

| Derived | From | Because |
| --- | --- | --- |
| `tsconfig.build.json` and its `references` | the build fragment and the package's deps | Node refuses to strip types under `node_modules`, so a published package needs built JavaScript |
| `files`, `scripts.build`, `publishConfig.access` | `packages/cli/fragments/package.public.json` | a scoped package defaults to private on npm, which fails `npm publish` with `402 Payment Required` |
| `publishConfig.exports` | `exports`, with `./src/X.ts` mapped to `./dist/X.js` | the workspace runs from source while consumers get the build |

The fragment's values win over a package's own, except `files`, where a package may add
entries beyond the fragment's.

**A public package depends only on public workspace packages.** A consumer cannot install a
private one. `make-public` refuses and lists the private dependencies to convert first, and
`pkg sync --check` reports the same thing if one appears later.

**Sync never deletes.** Setting `"private": true` by hand on a public package leaves its build
files behind, and `pkg sync --check` reports them until you remove them.

**Anything it must carry has to live inside its own directory.** A tarball cannot reach a
sibling. This is why `packages/cli/templates/` and `packages/cli/fragments/` sit inside the CLI
package rather than at the repo root.
