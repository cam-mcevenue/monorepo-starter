# Effect diagnostics: tsconfig or vite.config.ts

This repo combines two things. The `plugins` block in `tsconfig.effect.json` comes from
Effect's own repo, which runs plain `tsc`. The `lint` block in `vite.config.ts` comes from Vite+, which
runs Oxlint. Both involve the same Effect language service, and each file owns a different part
of it.

## The split

**The tsconfig files tell the analyzer about the code.** Options like `effectFn`,
`allowedUnstableApis`, `allowedExperimentalApis` and `allowedDuplicatedPackages` describe how
this codebase is written. They are facts the rules need to do their job, not policy. A fact the
whole repo shares goes in `tsconfig.effect.json`; a fact one package needs goes in that
package's own `tsconfig.json`, which merges with the base.

**`vite.config.ts` decides which rules run and how loudly.** Severities, the preset to extend,
and per-path exceptions through `lint.overrides`.

Put a severity in `vite.config.ts`. Put a project fact in the tsconfig plugin block.

## Why diagnostics are off in the plugin

`diagnostics: false` stops the language service reporting through the TypeScript server, so a
finding appears once from Oxlint instead of twice. This follows the upstream guidance in
`Effect-TS/tsgo/docs/README.md`, which recommends the same setting "so that Effect diagnostics
are reported only by Oxlint and do not appear twice".

Switching diagnostics off does not disable the Oxlint rules. It only silences the other
reporter. The editor still gets hovers, completions, refactors, goto and renames, each of which
has its own flag and defaults to on.

## Project facts are load-bearing

`effectFn: ["untraced"]` has to stay in the plugin block. Measured on the same violation, an
arrow function returning `Effect.gen`:

| tsconfig plugin | Oxlint rule | Result |
| --- | --- | --- |
| no `effectFn` | `"error"` | silent, the rule never fires |
| `effectFn: ["untraced"]` | `"error"` | `× effecttsgo(effect-fn-opportunity)`, `vpr check` fails |

So an Oxlint rule can be configured correctly and still do nothing, because the analyzer lacks
the project fact it needs. If a rule looks dead, check the plugin options before the severity.

## What `vpr check` reads

Only the Oxlint side. Severities in `diagnosticSeverity` never reach it, because wrapping `vp`
in `effect-tsgo` patches the Oxlint it starts and nothing else. The typecheck phase inside
`vp check` runs stock tsgo, which does not load the `plugins` block.

Measured, before `diagnostics` was switched off:

```
vpr check          ⚠ effecttsgo(effect-fn-opportunity)                  exit 0
effect-tsgo tsc -b error TS377047 ... effect(effectFnOpportunity)       exit 1
```

Nothing in `package.json` runs `effect-tsgo tsc`, so `diagnosticSeverity` shaped the editor and
nothing else. That is why those settings are gone.

Oxlint warnings do not fail `vpr check` either. It exits 0 with warnings present, so a rule
that must block needs `"error"`.

## Prefer an allowlist over a path exception

A rule that fires on sanctioned usage has two fixes, and the narrower one is usually a fact
rather than a severity.

`allowedUnstableApis` lists the unstable APIs this repo uses on purpose. The schema accepts a
package or module subtree such as `effect/cli`, or a single export written
`package/module#export`; the entries in use here are all subtrees. The rule then stays on
everywhere, and anything unstable that is not on the list still warns, including inside the CLI.

Switching the rule off for `packages/cli/**` would have done the same job and hidden more. Going
through the allowlist surfaced `effect/PlatformError`, an unstable import in `scaffold.ts` that
a path exception would have silenced without ever naming.

The same pattern exists for neighbouring rules: `allowedExperimentalApis` for
`experimental-api-usage`, and `allowedDuplicatedPackages` for `duplicate-package`.

## Scoping

Facts scope per package. Put the option in that package's own `tsconfig.json`, which merges
with the base, and no path pattern is involved. `packages/cli/tsconfig.json` does this.

Severities scope by path, through `lint.overrides` with a `files` glob in the **root**
`vite.config.ts`. Nothing in this repo needs one today, because the allowlists handle the only
case that came up.

A `lint` block in a package's own `vite.config.ts` does not work. Vite+ ignores nested lint
configs for the workspace-wide run, so it applies when you run `vp lint` from inside that
directory and is silently ignored by `vpr check` from the root. Measured: 0 warnings from the
package directory, 57 from the root.

The plugin also has an `overrides` array taking `include` and `exclude`, but those patterns
resolve relative to the config file that declares them, and a pattern that matches nothing
fails silently. The package's own tsconfig avoids the problem entirely.

## Current settings

`vite.config.ts` extends the `recommended` preset, which carries all 98 `effecttsgo` rules and
enables Oxlint's type-aware mode. On top of it:

- `effecttsgo/effect-fn-opportunity` raised to `"error"`, so the form this repo uses is enforced
  rather than suggested.

`unstable-api-usage` stays at the preset's `"warn"` everywhere, and the sanctioned APIs are
listed in `allowedUnstableApis`, split by who needs them:

| Config | Allows | Because |
| --- | --- | --- |
| `tsconfig.effect.json` | `@effect/vitest` | every package's tests import it |
| `packages/cli/tsconfig.json` | `@effect/vitest`, `effect/cli`, `effect/FileSystem`, `effect/Path`, `effect/PlatformError`, `@effect/platform-node` | only the CLI reaches for these |

A package's own `plugins` entry **merges** with the base key by key. The CLI declares only its
allowlist and still inherits `diagnostics: false` and `effectFn`, which was measured: an arrow
returning `Effect.gen` inside `packages/cli` still fails with `effect-fn-opportunity`.

Arrays inside the entry **replace**. The CLI's `allowedUnstableApis` drops the base's list, so
it repeats `@effect/vitest`; without it every CLI test warned `unstable-api-usage`, measured.

So a fact that one package needs belongs in that package's `tsconfig.json`, and a fact the whole
repo needs belongs in the base. Scoping this way keeps the warning live elsewhere, which is the
point: `scratchpad` importing `effect/cli` reports `unstable-api-usage`, measured.
