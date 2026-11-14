# ai-docs

Domain documentation: how to accomplish the tasks this project exists for. One directory per
topic under `ai-docs/src/`. This file is the map: find the topic, read the document, stop.

Repo mechanics live elsewhere. Commands, package work and code patterns are documented beside
the skills that disclose them, in `.agents/skills/<name>/`, so nothing here competes with them.
`.claude/skills` is a symlink to `.agents/skills`, so Claude Code reads the same files.

To place a document, swap one thing and see what survives. Change the business this repo serves
and keep the tooling: whatever is still true is repo mechanics, so it belongs with a skill.
Change the tooling and keep the business: whatever is still true belongs here.

Skills carry conventions, not laws. A repo scaffolded from this template that models errors
differently edits its own copy of that skill, and the two then diverge. That is expected, since
scaffolding copies once and never migrates.

A topic directory holds `.md` documents and may hold `.ts` files beside them. The `.ts` files
are examples and patterns that documents link to. Nothing builds or runs them, but
`ai-docs/tsconfig.json` covers every `.ts` file here, so `vpr check` type-checks each one as soon
as it lands.

## Writing a document here

Every `.md` file under `ai-docs/src/` carries frontmatter with a single `description` field,
written as the condition for reading it:

```md
---
description: How to price a quote, and which approvals a discount over 20% needs.
---

# Pricing a quote
```

The `description` is what routes an agent here, so it names the branches the document handles.
The title comes from the `# ` heading, so it is written once.

Documents colocated with a skill carry no frontmatter, because only `SKILL.md` is parsed and
that skill's own table routes its siblings.

The map below is maintained by hand today and generated later by `vpr cli aidocs`, which will
read those `description` fields and rewrite everything between the markers. Keep the markers.

## Map

<!-- doc-map:start -->

No topics yet.

<!-- doc-map:end -->
