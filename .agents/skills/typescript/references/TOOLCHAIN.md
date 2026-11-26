# Toolchain: Vite+

`package.json` lists the scripts and `vite.config.ts` lists the tasks under `run.tasks`. Read those for what exists; this skill covers what they cannot tell you.

## vpr runs the repo's, vp runs its own

`vpr <name>` (short for `vp run`) runs the repo's script or task of that name. `vp <name>` runs Vite+'s built-in of that name. When the two collide, the `r` selects the repo's, and the repo's version may wrap the built-in: a script like `effect-tsgo vp check` loads a plugin the bare built-in lacks, so `vp check` fails or checks less. Reach for `vpr` every time rather than tracking which names collide.

Run a single TypeScript file with `vpx path/to/file.ts`. It handles enums, decorators, JSX and tsconfig `paths`, so a Vite+ repo needs no `tsx` or `ts-node`.

## Where a new command belongs

| | Lives in | Cached |
| --- | --- | --- |
| Quality commands: format, lint, typecheck, test | `package.json` scripts | yes |
| Operational commands: anything that changes the repo or talks to you | `vite.config.ts` → `run.tasks` | usually not |

Quality commands are pure functions of the source, so caching them is free. Operational ones change state or prompt, so caching them is wrong.

- **An interactive task sets `cache: false`.** The task runner captures output rather than attaching a TTY, so a cached command that prompts prints its prompt and exits silently, with no error.
- **A task and a script cannot share a name.** Vite Task refuses to load the graph, so moving a script to a task means deleting the script.

## Toolchain ownership

Vite+ installs and selects Node and manages pnpm, so install with `vp install`.

- **Node**: pinned in `.node-version`. Vite+ reads it first; pnpm ignores it and acts on `devEngines.runtime` instead, so a pin there would put two tools in charge of Node. `engines.node` is the consumer-facing support range, a different claim from the development pin.
- **pnpm**: pinned in `devEngines.packageManager`, with `pmOnFail: ignore` in `pnpm-workspace.yaml` so pnpm never switches versions itself and Vite+ stays the single owner.
- **Platform binaries**: an install that fails fetching a native binary (`vite-plus`, `@effect/tsgo`) usually means `supportedArchitectures` in `pnpm-workspace.yaml` excludes this machine.

## Lint config

Lint rules live in a root `oxlint.config.ts` that `vite.config.ts` imports as its `lint` block, so the CLI and the editor read the same rules: an editor runs plain Oxlint, which cannot read `vite.config.ts`. Type it with `import type { OxlintConfig } from "vite-plus/lint"`; importing from `oxlint` fails in the editor, since `oxlint` is only a dependency of `vite-plus`.

A `lint` block in a nested package's `vite.config.ts` is ignored by the workspace run. It applies only to `vp lint` run inside that directory, so scope a rule by path through `overrides` with a `files` glob in the root config.

Oxlint warnings do not fail the check. A rule that must block is set to `"error"`.

Import cycles block: the root config enables the `import` plugin and sets `import/no-cycle` to `"error"`. A repo without it adds both.

Tests reach a package only through its name: an `overrides` entry whose `files` glob matches test files sets `no-restricted-imports` to `"error"` for any relative import into `src/`, so a test can't step around the `exports` map. A repo without it adds it.
