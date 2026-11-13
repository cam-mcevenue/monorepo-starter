# Toolchain

Vite+ owns the toolchain. It installs and selects Node, and it manages pnpm. Install
dependencies with `vp install`.

## Node

`.node-version` pins the version. Vite+ checks four sources in order and takes the first it
finds:

1. `.node-version`
2. `devEngines.runtime` in `package.json`
3. `engines.node`
4. `.nvmrc`

`.node-version` wins, every other tool reads it, and pnpm ignores it. That last point is why
the pin lives there: pnpm acts on `devEngines.runtime`, so declaring the version there would
put pnpm and Vite+ both in charge of Node, free to download or select different versions. The
escape hatch would then be `runtimeOnFail: ignore` in `pnpm-workspace.yaml`, a setting added
only to cancel a setting.

Keep `engines.node` as it is. It states the consumer-facing support range, a different claim
from the development pin.

## pnpm

`devEngines.packageManager` pins the pnpm version, and `pmOnFail: ignore` in
`pnpm-workspace.yaml` stops pnpm from switching versions on its own, leaving Vite+ as the
single owner. The declaration stays so a bare `pnpm` still knows what the project expects.

## TypeScript: tsrs

The type checker is tsrs, the Oxc team's Rust port of TypeScript 7, pinned in the `tooling`
catalog. There is no `typescript` package. `effect-tsgo` runs the Effect-patched build of the
pinned tsrs in three places: the `check` and `lint` scripts (`--tsrs-lint`), and both Zed
language servers in `.zed/settings.json`. Measured against tsgo on a probe file: the same
findings, and `vp check`'s lint and typecheck step at about 340ms instead of 435ms.

tsrs tracks a TypeScript beta, and Effect labels its tsrs support experimental. To switch back
to tsgo, Microsoft's TypeScript 7:

1. In the `tooling` catalog, replace `tsrs` with `typescript` at a 7.x release, and swap the
   root `devDependencies` entry to match.
2. In `package.json`, drop `--tsrs-lint` from the `check` and `lint` scripts.
3. In `.zed/settings.json`, drop `--tsrs-lint` from the `oxlint` arguments, and change the
   `effect-tsgo` arguments to `["tsc", "--lsp", "--stdio"]`.
4. Change `tsrs -b` to `tsc -b` in the build script of
   `packages/cli/fragments/package.public.json`, if that file exists, then run
   `vpr cli pkg sync`.
5. Run `vp install`, restart Zed, and run `vpr check` and `vpr test`.

## Platform pin

`supportedArchitectures` in `pnpm-workspace.yaml` is pinned to `arm64` and `glibc`, which
matches the development machines and the Docker sandbox. An x64 machine cannot install this
repo: pnpm refuses to fetch the x64 binaries for `vite-plus` and `@effect/tsgo`, and the
install fails outright.

Adding CI means either ARM runners (`ubuntu-24.04-arm`) or widening `cpu` to include `x64`.
GitHub's `ubuntu-latest` is x64 and fails at install.

## Version freshness

`minimumReleaseAge: 0` turns off the release-age gate. This repo runs current versions on
purpose: Effect 4, TypeScript 7, Node 26, alchemy beta. Pins in the catalogs are exact, and
bumping them is a deliberate edit rather than a scheduled one, since there is no update bot.
