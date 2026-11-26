---
name: handoff
description: Write the conversation into a handoff document for a fresh session, and optionally start that session in the background.
argument-hint: "What will the next session be used for? Ask to start it now to launch it in the background."
disable-model-invocation: true
---

If `../core-skills/SKILL.md` isn't already in this session, read it first.

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the operator's OS (`$TMPDIR`, else `/tmp`; `%TEMP%` on Windows) - not the current workspace.

Open the document with the skills the next agent should read:

- If a `mode-*` skill was loaded this session, the first line is `Read <path> before anything else.`, with `<path>` the absolute path of that mode's `SKILL.md`. Then name the suggested skills in bold: the mode tells the next agent where they live.
- Otherwise, list the absolute path of each suggested skill's `SKILL.md` for the next agent to read.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information, since the document may become an agent's prompt.

If the operator passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

## Starting the next session

Only when the arguments ask for the next session to start now: read `references/<harness>.md` from this skill's folder for the harness you are running in (`claude.md` for Claude Code), and follow it. With no file for your harness, say so and give the operator the document's path.
