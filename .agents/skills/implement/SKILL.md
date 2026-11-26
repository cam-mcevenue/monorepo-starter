---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the operator in the spec or tickets.

If the operator passes a ticket reference, fetch it (`gh issue view <n> --json title,body,labels,comments`) and state its title before starting. If the reference is ambiguous, ask. If the ticket doesn't carry `ready-for-agent`, say so and wait for the operator's go-ahead: that label is the work queue.

Read the **tdd** skill, then follow it where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, read the **code-review** skill, then follow it to review the work.

Commit your work to the current branch.
