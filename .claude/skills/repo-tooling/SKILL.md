---
name: repo-tooling
description: Repo tooling. Use when running checks, tests or formatting, adding a script or task, configuring a lint rule or Effect diagnostic, running a TypeScript file, or installing dependencies.
---

# Repo tooling

`vpr <name>` runs this repo's scripts and tasks. `vp <name>` runs Vite+'s built-in of that
name, and every name here collides with one, so the `r` selects yours.

| Task | Read |
| --- | --- |
| Run checks, tests, formatting, the dev CLI, or add a script or task | [`commands.md`](./commands.md) |
| Node or pnpm versions, installing, a platform install failure | [`toolchain.md`](./toolchain.md) |
| Configure a lint rule or an Effect diagnostic | [`effect-diagnostics.md`](./effect-diagnostics.md) |

`vpr check` and `vpr test` are the gates. Run both, because a passing typecheck says nothing
about whether the code runs.
