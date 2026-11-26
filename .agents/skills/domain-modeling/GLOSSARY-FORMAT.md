# GLOSSARY.md Format

## Structure

```md
# {Domain Name}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

The root glossary is headed `# Glossary`.

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Only include terms specific to this project.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this project, or a general concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.
- **Link with relative Markdown links** (`[Invoice](../finance/GLOSSARY.md)`), never bare paths, so a link checker can verify them.

## Root or domain

- **Root `ai-docs/GLOSSARY.md`**: terms that mean the same thing in every domain.
- **A domain's `GLOSSARY.md`**: terms specific to that domain.

A term lives in exactly one glossary. When a word means different things in two domains, each domain defines its own meaning and the root glossary leaves it out.
