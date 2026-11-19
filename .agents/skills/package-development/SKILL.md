---
name: package-development
description: Package registration and layout. Use when adding a workspace package, making a private package publishable, renaming a package, moving its workspace path, or deciding what goes in src/ versus src/internal/.
---

# Package development

Read the document that matches the task. Each one carries the wiring and the gotchas for that
operation.

| Task | Read |
| --- | --- |
| Create or delete a package, add a template | [`adding-and-removing.md`](./adding-and-removing.md) |
| Register, rename, move, or publish a package | [`registration.md`](./registration.md) |
| Decide where code goes, or what a package exposes | [`conventions.md`](./conventions.md) |
| Wire tsconfig, override the Effect plugin, understand build configs | [`typescript.md`](./typescript.md) |
| Add a dependency or change a version | [`dependencies.md`](./dependencies.md) |

Creating a package goes through `vpr cli pkg add`, which copies a template and repoints its
`extends` for the new depth. A template copied by hand keeps an `extends` written for four
levels deep, which is the usual first break.
