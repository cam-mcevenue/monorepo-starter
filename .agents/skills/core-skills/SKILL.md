---
name: core-skills
description: Where skills live, and when to read the core ones. Read by modes, workers and other skills.
disable-model-invocation: true
user-invocable: false
---

# Core skills

The **operator** is the person running this session: they decide, approve and answer questions.

Anything in the repo's root `ai-docs/` overrides a skill where the two conflict.

Bundled skills named in bold are files: read `../<name>/SKILL.md` from this file's folder with the file-read tool. A skill of the same name in the skill listing is a different copy. When a trigger matches, here or in another skill, read that skill in full before acting.

A skill missing from disk isn't installed. In the main session, tell the operator once and ask: install it and retry, or carry on without it. As a worker, carry on and name the missing skill in your report.

## Triggers

- Domain terms, a glossary, an ADR, or a folder added, renamed or removed under `ai-docs/` → **domain-modeling**
- A question that needs primary sources, or reading to delegate → **research**
- Writing or editing a skill, `AGENTS.md` or `CLAUDE.md` → **writing-for-agents**

## Principles

Each entry names when it applies. Each is the **principle-<title>** skill, with the title in kebab case, hyphens kept and other punctuation dropped. Read a principle in full before you apply it. A mode can list more.

In your final report, name each principle that shaped a decision and the choice it changed. Cite only principles you read this session.

- **Explain the Number.** Before you measure, and before you trust, report or act on a number you measured.
- **Prove It Works.** Before you declare a task done.
- **Attack the Premise.** Two or more fixes that share one premise have failed the same check.
- **Build the Lever.** Any non-trivial work: build the script or check that does it or proves it.
- **Encode Lessons in Structure.** You're writing the same instruction a second time, or the operator corrects the same mistake again.
- **Guard the Context Window.** Context is filling: large outputs, long files, repeated reads, fan-out planning.
- **Sequence Verifiable Units.** Multi-step work: sweeps, migrations, runs of similar edits.
