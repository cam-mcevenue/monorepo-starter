# Adding and removing packages

The dev CLI owns both directions:

```sh
vpr cli pkg add                            # prompts for template, name, then type
vpr cli pkg add my-package --template pkg-effect --private
vp install                                 # link it into the workspace

vpr cli pkg rm                             # prompts for which package
vpr cli pkg rm my-package --yes            # skip the confirmation
vp install
```

`--public` makes the new package publishable; [`registration.md`](./registration.md) covers
what that adds. It checks for the npm scope before copying anything, so a failed
`pkg add --public` leaves no directory behind.

`pkg add` does four things a hand-built package misses:

1. Copies the chosen template from `packages/cli/templates/`.
2. Rewrites the package name to `@repo/<name>`, and repoints every reference to the template's
   own package name across the copied `.ts` and `.json` files.
3. Prunes `node_modules` and `dist`, which `cp -r` would otherwise carry over from the
   template's own install.
4. Repoints the copy's `tsconfig.json` `extends` from the template's depth to
   `packages/<name>`.

`pkg rm` deletes the directory, behind a confirmation prompt that defaults to no. It refuses
while any workspace member lists the package in `dependencies`, `peerDependencies` or
`devDependencies`, and names each one to edit first. Every refusal comes before the prompt.
Removing a public package leaves any release on npm untouched.

A template copied by hand keeps `../../../../tsconfig.base.json`, which from `packages/<name>`
points above the repo, and `vpr check` fails with `typescript(tsconfig-error)`.

`pkg rm` refuses to delete `packages/cli`, and leaves it out of the picker. Deleting the tool
you are running is available by hand if you mean it.

## Adding a template

A template is a directory under `packages/cli/templates/` containing a `package.json`. The CLI
reads the list from disk, so creating the directory is the whole registration step.

Templates are workspace members through the `packages/cli/templates/*` glob, which is what
keeps them honest: `vpr check`, `vpr lint` and `vpr test` all run against them, so a template
that stops compiling fails the build.

Two things a new template needs:

- **A `tsconfig.json` extending `../../../../tsconfig.base.json`**, the path from where the
  template sits. `pkg add` repoints it for the copy, and the scaffold test fails any template
  whose `extends` misses the root base in either place.
- **A test.** It proves the toolchain end to end from a fresh copy.

The template's own package name is whatever you call it. The CLI reads it from the manifest
rather than assuming, so nothing needs editing when you add one.
