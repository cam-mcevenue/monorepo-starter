# Renaming and moving a package

## Renaming

The name appears in more places than the manifest:

1. `package.json` `name`.
2. Imports across the repo, including `workspace:*` dependents.
3. The package's boundary guard (see [`PACKAGES.md`](./PACKAGES.md)), which names its own package.

A rename that also changes the directory is a move too.

## Moving

Changing a package's path touches:

1. The `pnpm-workspace.yaml` glob that matched the old path.
2. The relative `extends` in its `tsconfig.json`, if the depth changes.
3. Build `references` in other packages that pointed at the old path.

Use `git mv` so history follows the files, then reinstall to relink the workspace.
