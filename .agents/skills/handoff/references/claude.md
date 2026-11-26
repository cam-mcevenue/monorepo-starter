# Starting the next session in Claude Code

Launch a background agent seeded with the handoff document as its prompt:

```sh
claude --bg --name "<descriptive name>" -- "$(cat <handoff file>)"
```

- Passing the file keeps the shell from running backticks or expanding `$` in the document.
- Always pass `--name` with a descriptive name (e.g. `--name "Fix login bug"`): it sets the display name shown in the job list, session picker, and terminal title.
- It starts in the current working directory and returns immediately. Tell the operator they manage it with `claude agents`.
