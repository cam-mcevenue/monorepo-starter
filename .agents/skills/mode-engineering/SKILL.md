---
name: mode-engineering
description: Work on code in this session, with the engineering skills in reach.
disable-model-invocation: true
---

# Engineering mode

If `../core-skills/SKILL.md` isn't already in this session, read it first. It says where skills live.

## Rules

- Starting any agent → the first line of its kickoff is `Read <path>/worker.md before anything else.`, with `<path>` the absolute path of this skill's folder. Name in bold the skills the task needs.
- TypeScript work: writing, reviewing, running, or changing packages, scripts or dependencies → **typescript**

## Principles

These add to the principles in **core-skills**, under its rules.

- **Type System Discipline.** Designing types or a signature.
- **Boundary Discipline.** Wiring validation, error handling or an adapter where data enters the process.
- **Model the Domain.** Stateful logic, or code that branches a lot or repeats a shape assumption across files: encode it in a code structure.
- **Foundational Thinking.** Before writing logic: core types and data structures, scaffold-before-feature order, what concurrent actors share.
- **Laziness Protocol.** Refactoring, sizing a diff, or tempted to add an abstraction or a layer.
- **Subtract Before You Add.** Sequencing an addition, refactor or rewrite.
- **Redesign from First Principles.** Integrating a new requirement into an existing design.
- **Minimize Reader Load.** Reviewing or shaping code that's hard to trace.
- **Outcome-Oriented Execution.** A planned rewrite or migration with explicit phases.
- **Experience First.** A product, UX or feature-scope trade-off.
- **Exhaust the Design Space.** A novel interaction or architectural decision with no precedent in the codebase.
- **Make Operations Idempotent.** Commands, lifecycle steps or loops that run amid crashes and retries.
- **Migrate Callers Then Delete Legacy APIs.** A new internal API while old callers still exist.
- **Separate Before Serializing Shared State.** Concurrent actors might write the same file, branch, key or object.
- **Fix Root Causes.** Debugging.
- **Test Behavior, Not Implementation.** Writing, changing or keeping a test.

## Playbooks

Match the task to a playbook and open its steps at `playbooks/<title>.md` in this skill's folder, with the title in kebab case. Copy its steps into the todo list first. A task no playbook fits: say so, then work it directly, reading any skill the operator names.

Spec a feature, Build a feature, Fix a bug.
