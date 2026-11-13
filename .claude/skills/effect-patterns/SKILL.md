---
name: effect-patterns
description: Effect code patterns in this repo. Use when modelling errors, writing a function that returns an Effect, or a lint rule reports a leaked library error.
---

# Effect patterns

| Task | Read |
| --- | --- |
| Model errors, or a lint rule reports a leaked library error | [`errors.md`](./errors.md) |

`effecttsgo/effect-fn-opportunity` is `"error"` in `vite.config.ts`, so a function returning
`Effect.gen` is written `Effect.fnUntraced(function* () {})` or the build fails.

`effecttsgo/unstable-api-usage` stays at `"warn"`. Effect 4 declares much of its own surface
unstable, so the APIs this repo sanctions are listed in `allowedUnstableApis` per package, and
anything else warns. The repo-tooling skill's `effect-diagnostics.md` covers where each setting
lives and why.
