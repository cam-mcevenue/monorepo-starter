# Dependencies

Versions live in the catalogs in `pnpm-workspace.yaml`, and manifests reference them by name:

```yaml
catalogs:
  effect:
    effect: 4.1.4
```

```json
"dependencies": { "effect": "catalog:effect" }
```

Add the version to the catalog first, then reference it. A version written directly into a
package manifest is the thing catalogs exist to prevent: two packages drifting onto different
versions of the same library.

There are three catalogs. `effect` holds Effect and its ecosystem, `infra` holds alchemy and
its providers, `tooling` holds the toolchain. Internal packages use `workspace:*` instead and
appear in no catalog.

`catalogMode: prefer` means pnpm reaches for a catalog entry when one exists.

## Over-stocked on purpose

The catalogs list more than this repo uses. `infra` is all alchemy packages and nothing imports
them yet. That is deliberate: a scaffolded repo starts with the libraries these projects
usually need, and deleting an unused entry is faster than going to find the right version.

An unused catalog entry costs nothing. It only installs when a package references it.

## Versions are exact and current

Catalog entries are exact versions, not ranges, and `minimumReleaseAge: 0` turns off the
release-age gate. This repo runs current releases on purpose: Effect 4, TypeScript 7, Node 26,
alchemy beta.

No bot updates them. A bump is a deliberate edit, which means a repo left alone stays exactly
where you left it.
