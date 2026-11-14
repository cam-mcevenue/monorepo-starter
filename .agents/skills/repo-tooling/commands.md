# Commands

`package.json` lists the scripts and `vite.config.ts` lists the tasks. Read those for what
exists. This document covers what they cannot tell you.

## vpr runs yours, vp runs its own

`vpr` is shorthand for `vp run`, which runs this repo's scripts and tasks. `vp <name>` runs
Vite+'s built-in command of that name instead.

Every name in this repo collides with a built-in, so the `r` is what selects yours:

```sh
vpr check     # this repo's check script
vp check      # Vite+'s built-in check
```

The `check` and `lint` scripts wrap `vp` in `effect-tsgo --tsrs-lint`, which preloads the
patched Oxlint binding carrying the Effect rules, and runs the type-aware rules and the
typecheck on the tsrs pinned in the `tooling` catalog. Running those built-ins skips the
wrapper and fails with `Unknown plugin: 'effecttsgo'`, measured on both. `format`, `format:check` and `test` need no
wrapper, so reaching for `vpr` everywhere is simpler than remembering which do.

Run a single TypeScript file with `vpx path/to/file.ts`. It handles enums, decorators, JSX and
tsconfig `paths`, which is why this repo has no `tsx` or `ts-node`.

## Where a new command belongs

Scripts in `package.json` are for code quality: formatting, linting, typechecking, tests.
Everything else is a task in `vite.config.ts` under `run.tasks`.

| | Lives in | Cached |
| --- | --- | --- |
| Quality commands | `package.json` scripts | yes |
| Operational commands | `vite.config.ts` → `run.tasks` | usually not |

Quality commands are pure functions of the source, so caching them is free. Operational
commands change the repo or talk to you, so caching them is wrong twice over.

Two rules follow.

**An interactive task sets `cache: false`.** The task runner caches by capturing output rather
than attaching a TTY, so a cached command that prompts prints its prompt and exits without
reading input. No error, no stack trace, just a silent exit. Both current tasks set it.

**A task and a script cannot share a name.** Vite Task refuses to load the graph when they do,
so moving a script to a task means deleting the script.

## Verifying work

`vpr check` runs formatting, linting, typechecking and `vpr cli pkg sync --check`. `vpr test`
runs the tests. Those two are the only gates in this repo, since there is no CI.

Run both. A passing typecheck says nothing about whether the code runs, and `vpr test` is what
executes it.
