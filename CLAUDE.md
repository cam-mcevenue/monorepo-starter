# This repo

A pnpm monorepo on Effect 4, Vite+ and TypeScript 7. It is also the template other repos are
scaffolded from with `vp create github:`, so the root config is both what this repo runs on and
what every generated repo inherits.

## Layout

| Path | Holds |
| --- | --- |
| `ai-docs/` | domain documentation, mapped by `ai-docs/CONTEXT.md` |
| `apps/*` | deployable applications |
| `packages/*` | libraries, scope `@repo/*` |
| `packages/cli` | the dev CLI, and the templates `pkg add` copies |
| `packages/tsconfig` | `@repo/tsconfig`, the shared compiler settings |
| `scratchpad/` | throwaway playground, outside the conventions |

## Finding the rest

**Repo mechanics come from skills.** Commands, package work and code patterns are documented
beside the skills that disclose them, so they load when a task needs them.

**`ai-docs/CONTEXT.md` maps the domain documentation**: what this project exists to do, as
opposed to how this repo is wired.
