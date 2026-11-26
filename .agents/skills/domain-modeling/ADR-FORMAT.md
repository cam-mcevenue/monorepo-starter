# ADR Format

ADRs live in `_adrs/` folders: `ai-docs/_adrs/` for decisions that apply across domains, `ai-docs/<domain>/_adrs/` for one domain's. Each folder numbers its own: `0001-slug.md`, `0002-slug.md`, etc. A domain whose mode documents its own decision format uses that format in its `_adrs/` instead.

## Creating the folder

- **Root**: `ai-docs/_adrs/` exists from setup, holding a `.gitkeep`. Delete the `.gitkeep` when writing the folder's first ADR.
- **Domain**: create `ai-docs/<domain>/_adrs/` with the domain's first ADR, and add it to the domain's `ROUTER.md`.

## Template

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. An ADR can be a single paragraph. The value is in recording *that* a decision was made and *why*, not in filling out sections.

## Optional sections

Only include these when they add genuine value. Most ADRs won't need them.

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`): useful when decisions are revisited
- **Considered Options**: only when the rejected alternatives are worth remembering
- **Consequences**: only when non-obvious downstream effects need to be called out

## Numbering and references

Scan the folder for the highest existing number and increment by one.

Refer to a root ADR as `ADR-0003`, and to a domain's with its domain: `finance ADR-0003`. In a doc, link it: `[finance ADR-0003](../finance/_adrs/0003-cash-basis.md)`.

## Applying the test

The three-part test for offering an ADR is under "Offer ADRs sparingly" in the skill, already in context. If a decision is easy to reverse, skip it: you'll just reverse it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

### What qualifies

The test above is the same in every domain; what passes it differs by kind of domain.

**Any domain:**

- **Boundary and scope decisions.** "Customer data is owned by the Customer module; other modules reference it by ID only." "We don't take on hourly work." The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** "We're using manual SQL instead of an ORM because X." "We invoice on delivery, not upfront, because…" Anything where a reasonable reader would assume the opposite. These stop the next person from "fixing" something that was deliberate.
- **Constraints not visible in the work.** "We can't use AWS because of compliance requirements." "All invoices go out from one entity for tax reasons."
- **Rejected alternatives when the rejection is non-obvious.** If you considered GraphQL and picked REST for subtle reasons, record it; otherwise someone will suggest GraphQL again in six months.

**Codebase:**

- **Architectural shape.** "We're using a monorepo." "The write model is event-sourced, the read model is projected into Postgres."
- **Integration patterns between modules or services.** "Ordering and Billing communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in.** Database, message bus, auth provider, deployment target. Not every library: just the ones that would take a quarter to swap out.

**Business domains** (finance, marketing, writing and the like):

- **Policy and process.** "Bookkeeping runs on a cash basis, not accrual, because…"
- **Positioning and pricing.** "We sell to agencies, not freelancers." "Fixed-fee per project, because…"
- **Vendors that carry lock-in.** Accounting software, payroll provider, CRM: the ones that would take a quarter to move off.
