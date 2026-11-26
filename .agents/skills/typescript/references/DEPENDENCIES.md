# Dependencies

Versions live in the catalogs in `pnpm-workspace.yaml`, and manifests reference them by name:

```yaml
catalogs:
  effect:
    effect: x.y.z
```

```json
"dependencies": { "effect": "catalog:effect" }
```

Add the version to a catalog first, then reference it. A version written straight into a manifest is what catalogs exist to prevent: two packages drifting onto different versions of one library. `catalogMode: prefer` makes pnpm reach for a catalog entry when one exists. Internal packages use `workspace:*` and appear in no catalog.

Catalog entries are exact versions, not ranges. A bump is a deliberate edit, so a repo left alone stays where it was left.

An unused catalog entry costs nothing: it only installs when a package references it. A catalog may list more than the repo uses on purpose.

A workspace dependency of a public package is also a build reference (see [`TSCONFIG.md`](./TSCONFIG.md)), so adding or removing one means updating the package's `tsconfig.build.json` `references`, by the repo's dev CLI if it owns them.
