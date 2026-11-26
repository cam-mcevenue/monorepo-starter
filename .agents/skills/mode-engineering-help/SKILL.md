---
name: mode-engineering-help
description: Ask which skill or flow fits your situation in engineering mode.
disable-model-invocation: true
---

# Engineering mode help

Answer the operator's question about engineering mode and its skills, and hand them the prompt or command to send. A help question gets an answer, not the work: the operator asked how, so let them start it.

Before stating what a skill does or recommending a step be skipped, read that skill in full: the summaries here are for orientation only.

## Start a session

Type **`/mode-engineering`** at the start of a session on code. It reads **core-skills**, then matches each task to a playbook below. To take full control of a session instead, type a skill's command yourself. Keep to one mode per session; to switch, **`/handoff`** to a fresh one. A stack skill that isn't installed is named once, with the choice to install it or carry on.

## Playbooks

Most work runs through a **playbook**: steps the mode follows, reading each skill as it needs it, so the operator describes the task instead of typing commands. Each one lives in the **mode-engineering** skill's `playbooks/` folder; read it before describing it.

- **Spec a feature**: grill the idea with `/grill-with-docs`, then publish a spec or a single ticket, or go straight on to building something small. Try: "spec out bulk export for invoices".
- **Build a feature**: from a spec, a ticket or a grilling in this session, through `/implement` or `/implement-spec` to a PR. Try: "build #42".
- **Fix a bug**: from an issue or a symptom, through `/diagnosing-bugs` and `/code-review` to a PR. Try: "fix #57" or "the export times out on large accounts".

A small feature can run Spec then Build in one session. Keep the grilling, the spec and the tickets in **one unbroken context window**, so each builds on the same thinking. When a session nears the edge of the **[smart zone](https://www.aihero.dev/ai-coding-dictionary/smart-zone)** (~150k tokens), `/handoff` at the nearest phase boundary (see Phase boundaries).

## Flows without a playbook

- **Bugs and requests piling up** → **`/triage`**. It moves issues through triage roles and produces agent-ready issues, which **Build a feature** later picks up. Triage is only for issues **you didn't create**: tickets that `/to-tickets` produced are already agent-ready, so **don't triage them**.

- **A huge, foggy effort: a greenfield project or a huge feature build, too big for one session** → **`/wayfinder`**, the most cognitively demanding flow here. It charts a **shared map** of **decision tickets** on the issue tracker and resolves them one at a time, producing **decisions, not deliverables**, until the way is clear. Where **Spec a feature** sharpens an idea you can hold in one session, wayfinder is for the idea you can't, so save it for exactly that, never a well-scoped feature.

  When the map clears, **it hands off, it doesn't build**: write the spec with `/to-spec`, which collapses the map's linked decisions into a buildable plan, then run **Build a feature** on it.

- **After a build or a fix** → **`/retro`** looks back over the session and suggests changes to the agent's **environment**, not the code: navigation pointers, automated checks, the coding standards `/code-review` enforces, steering files, tooling. Run it in the session it looks back on; the playbooks offer it.

## Codebase health

Not feature work, just upkeep.

- **`/improve-codebase-architecture`** runs whenever you have a spare moment to keep the codebase good for agents to operate in. It surfaces **deepening opportunities**; picking one _generates an idea_ you can take into **Spec a feature**. It's the survey that finds the candidates; **`/architect`** (below) is the bench you design the chosen one on.

## Vocabulary underneath

Two references that run *beneath* the other skills, each the single source of truth for its vocabulary. Reach for `/domain-modeling` directly when the **words**, not the process, are the problem. Reach for `/architect` when a module's **shape** is the problem; the skills above also pull in its vocabulary.

- **`/domain-modeling`**: sharpen the project's *domain* language: challenge a fuzzy term, resolve an overloaded word ("account" doing three jobs), record a hard-to-reverse decision as an ADR. It's the active discipline `/grill-with-docs` drives to keep each glossary clean.
- **`/architect`** is the deep-module vocabulary (module, interface, depth, seam, adapter, leverage, locality) for designing a module's *shape*: a lot of behaviour behind a small interface at a clean seam. Run it to sketch types, signatures and module structure before writing code; `/tdd` and `/improve-codebase-architecture` both speak its vocabulary.

## Phase boundaries

A **phase** is a chunk of work inside a session: the grilling, the implementation, the QA. At the **boundary** between two of them you have four options, and picking between them is the fuzziest decision in this whole map:

- **Continue**: stay put. Costs nothing, loses nothing.
- **`/clear`**: empty the window, when nothing here matters to what's next.
- **Subagent**: send a tightly-scoped task to its own window and get a report back.
- **`/handoff`** writes a portable markdown file and seeds a fresh session with it. The **default**, at the bottom of the tree rather than the first reach.

Read [PHASE-BOUNDARIES.md](PHASE-BOUNDARIES.md) for the ordered tree: the four questions, the reasoning behind each branch, and why the primary-source cost makes **Continue** the one to rule out first. Make the decision **at** a boundary; mid-phase, continue or split the rest into subagents.

## Standalone

Off the playbooks entirely.

- **`/grill-me`**: the same relentless interview as `/grill-with-docs`, but **stateless**: it saves nothing locally and builds no glossary. Reach for it when you are **not working in a working directory** (sharpening a plan, a design, a piece of writing, anything with no repo under it). If you are in a working directory, use `/grill-with-docs` instead: it runs the same interview and leaves a paper trail, so it is strictly the better one.
- **`/prototype`** is a small, throwaway program that answers one design question: does this state model feel right, or what should this UI look like. Throwaway is a constraint on how the code is written, not a promise to destroy it: the answer folds into the real code, and the prototype itself is kept as a **primary source** on a `prototype/<name>` branch out of main, pointed at from the implementation issue. **Spec a feature** offers it as a detour, but reach for it any time a design question is hard to settle on paper.
- **`/research`**: delegate reading legwork to a **background agent**: it investigates a question against **primary sources**, then leaves a cited Markdown file in the repo. Keep working while it reads. The file it produces is something to take *into* **Spec a feature**, since research feeds the thinking rather than replacing it.
- **`/to-questionnaire`** comes in when the thing blocking you isn't in your head or the codebase but in **someone else's**, and it writes them a questionnaire to fill in. It's the inverse of `/grill-me`: instead of interviewing you about the subject, it interviews you about the **send** (who it's going to, what you need back) and aims the questions at the gap. What comes back is material for `/grill-with-docs` or `/to-spec`.
- **`/wait-what`** is the corrective for a message that didn't land. Use it mid-conversation, inside any other skill, and the agent re-pitches what it just said with the context you were missing, in plain English, using the glossary vocabulary. It works after the fact; `/grill-with-docs` is the upfront cure, because a shared language agreed early is what stops the jargon arriving at all.
- **`/learn`**: learn a concept over multiple sessions, using the current directory as a stateful workspace.
- **`/teach`**: understand a body of work already in the repo (a subsystem, a change) in one plain explanation, built from **`/how`** (how it works) and **`/why`** (why it's that way, from the commits and PRs).
- **`/correct`**: when you keep correcting agents for the same mistake, change the repo so the next agent can't make it.
- **`/unslop`**: cut AI tells from a piece of writing.
- **`/writing-for-agents`** is the reference for writing documents agents consume: skills, AGENTS.md, pointed-at docs.

## Precondition

**`/ai-docs-setup`**: run once per repo to scaffold `ai-docs/`, the glossary, routers and ADRs the other skills read and write. Add domains with **`/domain-create`**. Issues go to GitHub through `use-issue-tracker`, with nothing to configure.
