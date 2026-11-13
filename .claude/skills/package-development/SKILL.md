---
name: package-development
description: Package registration. Use when adding a workspace package, making a private package publishable, renaming a package, or moving its workspace path.
---

# Package development

Read the document that matches the task. Each one carries the wiring and the gotchas for that
operation.

| Task | Read |
| --- | --- |
| Create or delete a package, add a template | [`adding-and-removing.md`](./adding-and-removing.md) |
| Register, rename, move, or publish a package | [`registration.md`](./registration.md) |
| Decide where code goes, or what a package exposes | [`conventions.md`](./conventions.md) |
| Wire tsconfig, project references, the tests project | [`typescript.md`](./typescript.md) |
| Add a dependency or change a version | [`dependencies.md`](./dependencies.md) |

Creating a package goes through `vpr cli pkg add`, which wires all four registration points.
Building one by hand means wiring them yourself, and the project reference is the one that
fails quietly.
