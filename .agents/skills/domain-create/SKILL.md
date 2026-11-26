---
name: domain-create
description: "Scaffold a new domain in ai-docs/: its router and glossary, its entry in the root router, and optionally its issue tracker label."
disable-model-invocation: true
---

# Domain Create

A **domain** is a top-level folder of `ai-docs/`: one self-contained area of the repo, such as `codebase/` or `finance/`, with its own router and glossary. This skill adds one.

## 1. Gather

- `ai-docs/ROUTER.md` must exist. If it doesn't, stop and tell the operator to run `/ai-docs-setup` first.
- **Name**: the folder name, lowercase and hyphenated (`finance`, `client-work`). It must not already exist under `ai-docs/`. Ask for one if the operator hasn't given it.
- **Purpose**: one sentence on what the domain holds and when an agent should open it. It lives in the root router line only; the domain's own files start with just a heading.
- **Issue tracker**: ask whether this domain's work will go in the issue tracker. Skip the question for `codebase`: its issues carry no domain label.

## 2. Present and confirm

Show the operator the drafts from step 3, and let them edit before anything is written.

## 3. Write

**`ai-docs/<name>/ROUTER.md`**:

```md
# <Name>

- [GLOSSARY.md](./GLOSSARY.md): terms specific to <name>. Read before naming a concept here.
```

**`ai-docs/<name>/GLOSSARY.md`**:

```md
# <Name>

## Language
```

**The root router entry**: add the domain to the `## Domains` section of `ai-docs/ROUTER.md`, replacing the `None yet` line if it's still there:

```md
- [<name>/](./<name>/ROUTER.md): <purpose>
```

The domain's `_adrs/` folder comes later, with its first ADR.

### If the domain uses the issue tracker

`ai-docs/ISSUE-TRACKER.md` must exist; if it doesn't, stop and tell the operator to run `/ai-docs-setup`, which creates it.

1. Create the label:
   - Only when the file says `Fork: yes`: `gh repo view --json nameWithOwner` must match its `Repo` line, since in a fork `gh` can target the upstream parent. On a mismatch, stop and tell the operator.
   - `gh label create domain:<name>`, with no description: `ai-docs/ISSUE-TRACKER.md` links the label to its domain.
2. List the label under `## Domain labels` in `ai-docs/ISSUE-TRACKER.md`, replacing the `None yet` line if it's still there:

   ```md
   - `domain:<name>`: [<name>](./<name>/ROUTER.md)
   ```

## 4. Done

Report the files created and changed, and the label if one was made.
