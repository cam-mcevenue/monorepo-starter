# TypeScript

## Public and internal modules

A public module is the package's API: a file consumers import by name. In a `src/` and
`src/internal/` layout, every top-level file in `src/` is one. An internal module is
implementation shared by a few public modules, kept under `internal/` and out of the package's
exports. A new file starts internal and becomes public when a consumer needs it.

## Imports

Import every module as a namespace, public or internal, including inside its own package and
in tests. Use `import type * as` when only its types are used. The one exception is a module
you take a single export from, which is imported by name.

```ts
import * as Plan from "./Plan.ts";
import type * as Model from "./Model.ts";
import * as Manifest from "./internal/manifest.ts";
import { decodeText } from "./internal/text.ts"; // the only export used from this module

const plan = yield* Plan.create(snapshot, template, name, "private");
```

## Export names

Name each export for its namespaced call site: `Plan.create`, not `Plan.planCreate`. A service
tag named after its module is the exception, and reads `Workspace.Workspace`.

## Tree-shaking

Namespace imports tree-shake like named imports while the namespace is only used through
member access. Passing it as a value, spreading it, or indexing it with a computed key keeps
the whole module.
