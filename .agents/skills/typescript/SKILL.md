---
name: typescript
description: "How TypeScript is written and run across my projects: the rules, modules, the Vite+ toolchain and the pnpm workspace."
user-invocable: false
disable-model-invocation: true
---

# TypeScript

Every TypeScript repo here is a pnpm workspace of TypeScript packages that run from source, with Vite+ as the toolchain. A repo's own documented conventions take precedence over this skill.

Apply **principle-type-system-discipline** and **principle-boundary-discipline** first. The rules below are how they're written in TypeScript.

## Effect

A module that imports from `effect`, or new code going into one → read **typescript-effect** after this skill. Where the two conflict, **typescript-effect** wins. A new module matches the modules around it in its package; when the package mixes both, ask the operator.

## Rules

| Rule | Summary |
|------|---------|
| Discriminated unions | Model variants with a `kind` literal discriminant, so impossible states can't be represented. No optional-field bags. |
| Branded types | `string & { readonly __brand: "X" }`. A brand comes from a verifying type guard (`input is AgentId`) or a schema decode, never from `as`. |
| Constructive modeling | Build the shape so the illegal value can't be constructed: `[T, ...T[]]` for non-empty, `[T, T][]` for even length, `start` plus `duration` for a range. Not a runtime guard. |
| Simplest total type | Keep `T[]` while every operation on it stays total. Strengthen to `NonEmpty<T>` only where the loose type forces `!`, a cast, or a "should never happen" throw. |
| `unknown` over `any` | External data is `unknown`. |
| Schemas before guards | Effect Schema owns each external shape, and the type is derived from it. Outside Effect code, decode with `Schema.decodeUnknownResult` and guard with `Schema.is`. |
| No `as` casts | Every `as` is a runtime crash waiting. Cast only after validation. |
| Narrowing hierarchy | Discriminant switch > `in` operator > `typeof`/`instanceof` > user-defined type guard > `as`. |
| Type guards | Must verify the claim: a lying guard is worse than `as`. Name them `isX` or `hasX`. |
| Exhaustiveness | Inline `const _exhaustive: never = x;` in default arms, so a new variant is a compile error. |
| `satisfies` over `as` | Validates the value without widening literal types. |
| Boundary validation | Parse where data crosses a system boundary, into a named domain type. `Record<string, unknown>` stops at that parse. |
| Schema-derived types | Reach for `Pick`/`Omit`/`Parameters`/`ReturnType`/`Awaited`/`typeof` before declaring a new interface. |
| No cycles | Modules never import each other in a cycle, inside a package or across packages. The lint enforces it (`references/TOOLCHAIN.md`). |
| Object args | Pass objects, not positional arguments, so argument order is self-documenting. Skip on hot paths (per-frame render, tokenizers, parsers). |
| Tests | Read **tdd**. A test imports a package by its name and public modules, never its internals or a relative path into `src/` (`references/TSCONFIG.md`). The lint enforces it (`references/TOOLCHAIN.md`). |
| Structured telemetry | Structured logger diagnostics with enough context to debug from an id. No `console.log` in shipped code. |

## Verifying

Run `vpr check` and `vpr test`, both, before calling work done: a passing typecheck says nothing about whether the code runs, and only the tests execute it.

## References

| Task | Read |
| --- | --- |
| An example of a rule above | [`references/PATTERNS.md`](./references/PATTERNS.md) |
| Public and internal modules, imports, export names | [`references/MODULES.md`](./references/MODULES.md) |
| Running a script or task, adding one, installing, Node and pnpm versions, lint config | [`references/TOOLCHAIN.md`](./references/TOOLCHAIN.md) |
| Adding or removing a package, the exports map, the boundary guard, the package scope | [`references/PACKAGES.md`](./references/PACKAGES.md) |
| tsconfig layering, build configs, how tests import | [`references/TSCONFIG.md`](./references/TSCONFIG.md) |
| Adding a dependency or changing a version | [`references/DEPENDENCIES.md`](./references/DEPENDENCIES.md) |
| Renaming or moving a package | [`references/MOVING.md`](./references/MOVING.md) |
