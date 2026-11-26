---
name: principle-sequence-verifiable-units
description: "Apply to multi-step work (sweeps, migrations, runs of similar edits). Break work into small units that each end in a verifiable state, check each before the next, and order the work so the sequence proves itself to a reviewer."
user-invocable: false
disable-model-invocation: true
---

# Sequence work into verifiable units

Order work as small units that each end in a state you can check, and do not advance until the current one is green.

In a sweep, migration, or run of similar edits, each unit is a bracket: known-good state, one change, run the check, proceed. Run the per-unit check even when a tool does the edits.

Deliver in the order that proves the work: the failing test first, then the fix. The subtraction before the reshape. The baseline before the treatment. Each unit ends in a state the operator can review.
