# Adding and removing packages

The dev CLI owns both directions:

```sh
vpr cli pkg add                            # prompts for template, then name
vpr cli pkg add my-package --template pkg-effect
vp install                                 # link it into the workspace

vpr cli pkg rm                             # prompts for which package
vpr cli pkg rm my-package --yes            # skip the confirmation
vp install
```

`pkg add` does four things a hand-built package misses:

1. Copies the chosen template from `packages/cli/templates/`.
2. Rewrites the package name to `@repo/<name>`, and repoints every reference to the template's
   own package name across the copied `.ts` and `.json` files.
3. Prunes `node_modules` and `dist`, which `cp -r` would otherwise carry over from the
   template's own install.
4. Inserts `{ "path": "packages/<name>" }` into `tsconfig.workspace.json`.

`pkg rm` reverses it: deletes the directory and drops the project reference, behind a
confirmation prompt that defaults to no.

A package built by hand compiles fine and sits outside the solution build, so `vpr check`
never looks at it. That is the failure worth avoiding.

`pkg rm` refuses to delete `packages/cli`, and leaves it out of the picker. Deleting the tool
you are running is available by hand if you mean it.

## Adding a template

A template is a directory under `packages/cli/templates/` containing a `package.json`. The CLI
reads the list from disk, so creating the directory is the whole registration step.

Templates are workspace members through the `packages/cli/templates/*` glob, which is what
keeps them honest: `vpr check`, `vpr lint` and `vpr test` all run against them, so a template
that stops compiling fails the build.

Two things a new template needs:

- **A `tsconfig.json` extending `@repo/tsconfig/base.json`**, with `@repo/tsconfig` as a
  devDependency. The specifier resolves the same at any depth, which is how one file works
  both in the template at four directories deep and in the copy at two.
- **A test.** The tests project is an error when empty, so at least one template carries a
  passing test. It also proves the toolchain end to end from a fresh copy.

The template's own package name is whatever you call it. The CLI reads it from the manifest
rather than assuming, so nothing needs editing when you add one.
