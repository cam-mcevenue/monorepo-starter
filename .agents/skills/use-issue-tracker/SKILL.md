---
name: use-issue-tracker
description: File, read, label, link, block and close this repo's issues.
user-invocable: false
disable-model-invocation: true
---

# Use Issue Tracker

Issues for this repo live in its GitHub Issues. Drive them with the `gh` CLI, run from inside the clone so it infers the repo.

## Before the first write of a session

1. **Repo context.** Read `ai-docs/ISSUE-TRACKER.md`: this repo's target repo, domain labels and notes. This skill defines the workflow; the file adds what's specific to the repo. If the file is missing, stop and tell the operator to run `/ai-docs-setup`.
2. **`gh` version.** `gh --version` must be 2.94 or later, the first with native sub-issues and blocking. On anything older, stop and tell the operator to upgrade `gh`.
3. **Target repo.** Only when the file says `Fork: yes`: in a fork, `gh` can target the upstream parent, so `gh repo view --json nameWithOwner` must match the file's `Repo` line. On a mismatch, stop and tell the operator.

Done when all three have run once this session.

## Labels

This table is the label set for every repo. Each meaning doubles as the label's description on GitHub.

| Group | Label | Meaning |
|---|---|---|
| Type | `bug` | Something is broken |
| | `enhancement` | A new capability or an improvement |
| | `documentation` | Docs to write or fix |
| | `spec` | Holds a spec; its tickets are its sub-issues |
| State | `needs-triage` | Waiting for the owner to evaluate |
| | `needs-info` | Waiting on the reporter for more information |
| | `ready-for-agent` | Fully specified, ready for an agent to implement |
| | `ready-for-human` | Needs a human to implement |
| Outcome | `wontfix` | Closed: decided not to do it |
| | `duplicate` | Closed: another issue covers it |
| | `deferred` | Closed: not now, maybe later |

- **Type**: exactly one on every open issue.
- **State**: at most one; a `spec` carries none. A state change is one edit that swaps labels: `gh issue edit <n> --remove-label needs-triage --add-label ready-for-agent`.
- **Outcome**: applied only when closing, see [Closing without doing](#closing-without-doing).
- **Domain** (`domain:<name>`): no domain label means `codebase`; every other domain's issues carry its label. The domains with a label are listed under `## Domain labels` in `ai-docs/ISSUE-TRACKER.md`; match an issue to its domain by the domain's line in `ai-docs/ROUTER.md`. When an issue belongs to a domain that isn't listed, stop and tell the operator: that domain needs a label (`/domain-create` adds one) before its issues can go in the tracker.

When a label from the table is missing on GitHub (the table gained it after this repo was set up), create it: `gh label create <name> --description "<meaning>"`.

### The work queue

`ready-for-agent` is the agent's work queue: implement an issue only while it carries that label.

An **external issue** is one whose author (`gh issue view <n> --json author`) is not the operator (`gh api user --jq .login`). It starts at `needs-triage`, and moves to `ready-for-agent` or `ready-for-human` only when the operator says so in the current session. `gh` acts as the operator, so GitHub cannot tell who applied a label: the session's instruction is the approval.

## Commands

- **Create**: `gh issue create --title "..." --label <type>,<state> --body-file - <<'EOF'` with the body in the heredoc.
- **Read**: `gh issue view <n> --json number,title,body,labels,state,author,comments`.
- **List**: `gh issue list --state open --label <label> --json number,title,labels,assignees`.
- **Comment**: `gh issue comment <n> --body "..."`.
- **Sub-issue**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards.
- **Blocking**: `gh issue create --blocked-by <n>,<n> ...`, or `gh issue edit <child> --add-blocked-by <blocker>`. An issue is unblocked when every blocker is closed.
- **Open blockers**: `gh issue view <n> --json blockedBy --jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`; `0` means startable.
- **Claim**: `gh issue edit <n> --add-assignee @me`.
- **Close as done**: `gh issue close <n> --reason completed --comment "<what was done>"`.

## Specs and tickets

A **spec** is an issue labelled `spec` whose body is the spec. Its tickets are sub-issues, each with its own type and state labels. When closing a spec's last open ticket, close the spec too (`gh issue view <spec> --json subIssuesSummary` shows how many remain).

## Closing without doing

Each outcome is one sequence: remove the state label and add the outcome label, then close with the reason and comment below.

| Outcome | Close with |
|---|---|
| `wontfix` | `gh issue close <n> --reason "not planned" --comment "<why it won't be done>"` |
| `duplicate` | `gh issue close <n> --duplicate-of <original>` |
| `deferred` | `gh issue close <n> --reason "not planned" --comment "<why not now; what would bring it back>"` |

Find them later with `gh issue list --state closed --label <outcome>`.

**Reopening a deferred issue** sends it back through triage: `gh issue reopen <n>`, then `gh issue edit <n> --remove-label deferred --add-label needs-triage`.

## Pull requests

This skill handles issues only. External PRs are blocked in each repo's settings, so every PR is the operator's own work.

## Wayfinding

`/wayfinder` keeps its map and decision tickets as issues: see [WAYFINDING.md](WAYFINDING.md).
