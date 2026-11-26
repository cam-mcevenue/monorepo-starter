---
name: domain-modeling
description: "Build and sharpen a project's domain model in ai-docs/: glossaries, ADRs and routers."
disable-model-invocation: true
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* the glossary for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## File structure

The domain model lives in `ai-docs/`:

```
ai-docs/
├── ROUTER.md          entry point: the root files and every domain
├── GLOSSARY.md        terms shared across domains
├── ISSUE-TRACKER.md   this repo's context for use-issue-tracker
├── _adrs/             decisions that apply across domains
└── finance/           a domain
    ├── ROUTER.md
    ├── GLOSSARY.md    terms specific to this domain
    ├── _adrs/         decisions specific to this domain
    └── bookkeeping/   an ordinary subfolder
```

If `ai-docs/ROUTER.md` doesn't exist, stop and tell the operator to run `/ai-docs-setup`. When a topic needs a domain that doesn't exist yet, suggest the operator runs `/domain-create`: domains are created only through it.

Work in the domain the topic belongs to, matched by its line in the root router; if it's unclear, ask. A term or decision that holds across domains goes at the root.

## During the session

### Challenge against the glossary

When the operator uses a term that conflicts with the existing language in the glossary, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Challenge against the ADRs

When the operator proposes something that contradicts an existing ADR, surface it with the ADR's reference rather than silently going along: "That contradicts finance ADR-0003 (cash-basis bookkeeping). Reopen it, or work within it?"

### Sharpen fuzzy language

When the operator uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the operator to be precise about the boundaries between concepts.

### Cross-reference with the work

When the operator states how something works, check whether the work agrees: the code itself for the codebase domain, the domain's docs and records for any other. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update the glossary inline

When a term is resolved, update the right `GLOSSARY.md` right there: the domain's, or the root one for a term shared across domains. Don't batch these up: capture them as they happen. Use the format in [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md).

A glossary should be totally devoid of implementation details. Do not treat it as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).

### Keep the routers current

When you add, rename or remove a file or folder under `ai-docs/`, update its parent's `ROUTER.md` in the same change. Use the rules in [ROUTER-FORMAT.md](./ROUTER-FORMAT.md).
