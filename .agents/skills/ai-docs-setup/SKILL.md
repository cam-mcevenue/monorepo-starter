---
name: ai-docs-setup
description: "Scaffold ai-docs/ in a monorepo: root router, glossary, ADR folder, and the pointer agents follow to find them."
disable-model-invocation: true
---

# AI Docs Setup

If `../core-skills/SKILL.md` isn't already in this session, read it first.

Scaffold the root of `ai-docs/`, the home of every agent-facing doc in this monorepo:

```
ai-docs/
├── ROUTER.md          map of ai-docs/, read first every session
├── GLOSSARY.md        terms shared across domains
├── ISSUE-TRACKER.md   this repo's context for use-issue-tracker
├── _adrs/             decisions that apply across domains
└── <domain>/          one folder per domain, created by /domain-create
```

This skill creates only the root, and the repo's GitHub labels: domains come later, one at a time, through `/domain-create`.

## 1. Explore

Read what exists; assume nothing:

- `ai-docs/` and each root entry above.
- `AGENTS.md` and `CLAUDE.md` at the repo root, and whether either imports the other (a line like `@AGENTS.md`).
- A **legacy glossary**: `GLOSSARY.md` at the repo root, from before `ai-docs/`.
- The **target repo**: `gh repo view --json nameWithOwner,isFork`. If it fails, stop and tell the operator what's missing (a GitHub remote, or `gh` access).

## 2. Present and confirm

Show the operator what exists, what this skill will create, the drafts from step 3, and the target repo. When `isFork` is true, say so: `gh` can target the upstream parent, so the operator confirms which repo issues go to. If a legacy glossary exists, propose merging its terms into `ai-docs/GLOSSARY.md` under the seeded ones and deleting the root file; the operator decides.

Done when the operator has approved the drafts and the target repo and, if there is one, decided on the legacy glossary.

## 3. Write

Create each missing entry; an entry that already exists stays as it is.

**`ai-docs/ROUTER.md`**:

```md
# AI Docs

Start here. Each entry says what it holds and when to open it.

- [GLOSSARY.md](./GLOSSARY.md): terms shared across domains. Read before naming a concept.
- [_adrs/](./_adrs/): decisions that apply across domains. Read those touching your area.
- [ISSUE-TRACKER.md](./ISSUE-TRACKER.md): this repo's context for `use-issue-tracker`. Read before touching issues.

## Domains

None yet: add one with `/domain-create`.
```

**`ai-docs/GLOSSARY.md`**:

```md
# Glossary

Terms shared across every domain in this repo. Each domain keeps its own terms in its own GLOSSARY.md.

## AI docs

**Domain**:
A top-level folder of `ai-docs/` holding one self-contained area of the repo, with its own router and glossary.
_Avoid_: workspace, area, section

**Codebase**:
The domain covering the repo's code, in `ai-docs/codebase/`. Issues with no domain label belong to it.

**Router**:
A folder's `ROUTER.md`, listing each of the folder's immediate children: what it holds and when to open it.
_Avoid_: index, README

**Glossary**:
A `GLOSSARY.md` defining the terms used in its scope: the repo root for shared terms, a domain for its own.
_Avoid_: dictionary

**ADR**:
An architecture decision record in an `_adrs/` folder: a decision that is hard to reverse, and why it was made.
_Avoid_: decision doc, design doc

## Issue tracking

**Spec**:
An issue labelled `spec` whose body describes a piece of work. Its tickets are its sub-issues.
_Avoid_: PRD, epic

**Ticket**:
A sub-issue of a spec or a wayfinder map, labelled and closed on its own. A spec's tickets slice its work; a map's are decision tickets.
_Avoid_: story
```

**`ai-docs/_adrs/.gitkeep`**, so git tracks the empty folder.

**`ai-docs/ISSUE-TRACKER.md`**, with the confirmed target repo and whether it's a fork:

```md
# Issue tracker

Context for `use-issue-tracker` in this repo. The skill defines the workflow; this file adds what's specific to this repo.

**Repo:** <owner/name>
**Fork:** <yes|no>

## Domain labels

None yet: `/domain-create` adds them.

## Notes
```

**The GitHub labels**: read the **use-issue-tracker** skill, and create each label in its table with its meaning as the description: `gh label create <name> --description "<meaning>"`. A label that already exists stays as it is.

**The agent docs section**, in the instructions file agents load: the pointer to `ai-docs/`.

```md
## Agent docs

Agent docs live in `ai-docs/`. Start every session at [ai-docs/ROUTER.md](./ai-docs/ROUTER.md).
```

Pick the file for this section:

- If one of `CLAUDE.md` / `AGENTS.md` imports the other, edit the imported one.
- Else if `CLAUDE.md` exists, edit it; else if `AGENTS.md` exists, edit it.
- If neither exists, ask the operator which to create.

An existing `## Agent docs` section is updated in place. A `## Skills` section left by an earlier setup is removed. The rest of the file stays as the operator wrote it.

Then carry out the legacy decisions from step 2.

## 4. Done

Report what was created and moved, including the labels created on GitHub, and tell the operator to add domains with `/domain-create`.
