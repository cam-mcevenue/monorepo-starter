# Working in this repo

A pnpm monorepo template: Effect 4, Vite+ (`vp`) for format/lint/typecheck/test, TypeScript 7
via `@effect/tsgo`, alchemy available for infrastructure. Scaffolded from a template repo, so
the git history starts here.

## Commands

`vpr` is the shorthand for `vp run`, which runs this repo's `package.json` scripts. Use it for
everything below — not `vp <name>`, which runs Vite+'s own built-in of that name instead.

| Command             | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `vpr check`         | Format check, lint and typecheck everything        |
| `vpr lint`          | Lint only                                          |
| `vpr format`        | Fix formatting                                     |
| `vpr test`          | Run tests                                          |
| `vpr cli`           | This repo's dev CLI (`vpr cli --help`)             |
| `vpr skills`        | Manage agent skills (telemetry disabled)           |
| `vp install`        | Install workspace dependencies                     |

### Where a command belongs

**`package.json` scripts are for code quality only** — formatting, linting, typechecking,
tests. Everything else is a **task** in `vite.config.ts` under `run.tasks`.

| | Lives in | Cacheable |
| --- | --- | --- |
| `check` `lint` `format` `format:check` `test` | `package.json` scripts | yes |
| `cli` `skills`, and anything operational | `vite.config.ts` → `run.tasks` | usually not |

Two rules follow from it:

- **An interactive task needs `cache: false`.** The task runner caches by capturing output
  instead of attaching a TTY, so a cached command that prompts prints its prompt and exits
  immediately — no error, just a silent exit. Both current tasks set it.
- **A task and a script cannot share a name.** Vite Task refuses to load the graph if they do,
  so moving a script to a task means deleting the script.

Quality commands are cacheable because they are pure functions of the source; operational
commands mutate the repo or talk to you, so caching them is wrong on both counts.

**`vp check` and `vp lint` are not the same as `vpr check` and `vpr lint`.** The scripts wrap
`vp` in `effect-tsgo`, which preloads the patched Oxlint binding that provides the Effect rules;
bare `vp check` fails with `Unknown plugin: 'effecttsgo'`. Every script name here shadows a Vite+
built-in, so the `r` is what makes it run yours.

Run a TypeScript file with `vpx path/to/file.ts`. Do not add `tsx` or `ts-node`.

Vite+ docs are local at `node_modules/vite-plus/docs`, and its agent guidance at
`node_modules/vite-plus/AGENTS.md`.

## Layout

```
apps/*            deployable applications
packages/*        libraries, scope @repo/*
packages/cli      this repo's dev CLI — tooling for working IN the repo, not a product
templates/*       package templates `create-pkg` copies from
templates/pkg-effect  the default Effect library template
scratchpad        throwaway playground, outside the conventions
```

Templates are workspace members, so `check`/`lint`/`test` run against them and they cannot rot.
Adding a directory under `templates/` with a `package.json` is all it takes to make it an
offered choice — the CLI reads the list from disk.

Inside a package:

- `src/` — the public API. Every top-level module is importable as `@repo/pkg/ModuleName`.
- `src/internal/` — implementation. Blocked at the package boundary.
- `test/` — sibling of `src/`, with fixtures in `test/fixtures/`.

The boundary is enforced by the `exports` map, not just convention:

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

So `@repo/pkg/internal/thing` and `@repo/pkg/index` fail to resolve. Tests reach internals by
relative path (`../src/internal/thing.ts`), which is the intended escape hatch.

## Adding a package

```sh
vpr cli pkg add                            # prompts for template, then name
vpr cli pkg add my-package --template pkg-effect
vp install                                 # link it into the workspace
```

Removing one is the reverse — it deletes the directory and drops the project reference, with a
confirmation prompt (`--yes` to skip):

```sh
vpr cli pkg rm              # prompts for which package
vpr cli pkg rm my-package
vp install
```

That rewrites the package name, repoints every reference to the template's own package name,
prunes `node_modules`/`dist`, and adds the project reference to `tsconfig.workspace.json`.
Doing it by hand means doing all four. With one template it is selected automatically; with
several you get a picker.

## Adding an app

Use `vp create`, which scaffolds into an existing workspace and is maintained upstream:

```sh
vp create svelte --directory apps/web
vp create vite:application --directory apps/api
vp create --list    # built-in and shorthand templates
```

Do not hand-roll `app-*` templates — a vendored copy of a framework's scaffold goes stale and
`vp create` already covers svelte, nuxt, vue, next, react-router, @tanstack/start and more.

## Dependencies

Versions live in the **catalogs** in `pnpm-workspace.yaml` (`effect`, `infra`, `tooling`), and
packages reference them as `"effect": "catalog:effect"`. Add the version to the catalog first,
then reference it — never pin a version in a package manifest.

The catalogs are deliberately over-stocked with things used across projects. Unused entries are
expected; delete what a given repo does not need.

`effect/cli` ships inside the core `effect` package — there is no `@effect/cli` dependency.

## TypeScript config

- `tsconfig.base.json` — the real settings, extended by every package
- `tsconfig.workspace.json` — solution file, references each package
- `tsconfig.tests.json` — type-checks `{apps,packages}/*/{src,test}/**`
- `tsconfig.json` — root solution, references the two above

A new package extends `../../tsconfig.base.json` and needs an entry in
`tsconfig.workspace.json`. `tsconfig.workspace.json` is JSONC — edit it as text; a
`JSON.parse`/`stringify` round-trip deletes its comments.

## Skills

Skills live in `.claude/skills`. `.agents/skills` is a symlink to it, so agents reading either
location see the same set. Manage them with `vpr skills` (`add`, `list`, `check`, `update`),
which wraps the `skills` CLI with telemetry disabled. Installed skills and `skills-lock.json`
are committed, so a fresh clone needs no setup.

## Constraints

- `supportedArchitectures` in `pnpm-workspace.yaml` is pinned to arm64/glibc so installs work in
  the Docker sandbox. x64 machines cannot install this repo as configured.
- `minimumReleaseAge: 0` — this repo rides current versions (Effect 4, TypeScript 7, Node 26,
  alchemy beta) on purpose.
- No CI. `vpr check` and `vpr test` before committing are the only gates.
