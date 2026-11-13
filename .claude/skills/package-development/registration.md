# Package registration

A directory becomes a package when four things are true. `vpr cli pkg add` does all four; doing
it by hand means doing all four.

| Wiring | Where | Miss it and |
| --- | --- | --- |
| Workspace glob matches the directory | `pnpm-workspace.yaml` | no `node_modules`, no lockfile entry, `workspace:*` deps fail to resolve |
| Project reference | `tsconfig.workspace.json` | it compiles alone but `vpr check` never looks at it |
| `extends` the shared config | the package's `tsconfig.json` | settings drift from every other package |
| `@repo/tsconfig` devDependency | the package's `package.json` | nothing breaks today, see below |

The project reference is the quiet failure. A hand-built package type-checks when you open it
and sits outside the solution build, so nothing catches it rotting.

The devDependency is a declaration rather than a requirement. The root `package.json` also
declares `@repo/tsconfig`, so `node_modules/@repo/tsconfig` exists at the workspace root and
TypeScript finds it by walking up from any package. Deleting it from a package's manifest was
measured: `vpr check` and `tsc -b` both still pass. Declare it anyway, so the package states
what it uses and keeps working if the root ever stops declaring it.

**`tsconfig.workspace.json` is JSONC.** Edit it as text. A `JSON.parse`/`stringify` round-trip
deletes its comments, which is why the CLI inserts references with a string splice.

## Renaming a package

The name appears in more places than the manifest:

1. `package.json` `name`.
2. Imports across the repo, including `workspace:*` dependents.
3. The boundary guard in the package's own test, which names its own package.
4. `tsconfig.workspace.json` only if the directory name changes too.

Nothing renames the directory for you. A rename that changes both the name and the path is a
move as well, so follow the next section too.

## Moving a package

Changing a package's path touches the glob and the reference:

1. The `pnpm-workspace.yaml` glob that matched the old path.
2. The `tsconfig.workspace.json` reference path.
3. The `tsconfig.tests.json` globs, if the new location falls outside them. Sources and tests
   both need to be matched, or the package silently drops out of the tests project.

Depth no longer matters for `extends`, because every package extends the
`@repo/tsconfig/base.json` specifier rather than a relative path. That was a deliberate change:
templates live four directories deep and their copies land two deep, and one line has to work
in both.

Use `git mv` so history follows the files.

## Making a package publishable

Everything here runs from TypeScript source, so a package that leaves the workspace needs work
no internal package needs.

**It needs a real build.** Node refuses to strip types under `node_modules`, so a published
package whose `exports` point at `./src/*.ts` fails on install with
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Point `exports` at built JavaScript with a
`types` condition beside it.

**It needs `files`.** Absent, the tarball ships whatever npm decides, which is rarely what you
built.

**A scoped package needs `publishConfig.access: "public"`.** Scoped packages default to
private, and private scoped packages are a paid feature, so a bare `npm publish` fails with
`402 Payment Required`.

**Anything it must carry has to live inside its own directory.** A tarball cannot reach a
sibling. This is why `packages/cli/templates/` sits inside the CLI package rather than at the
repo root.
