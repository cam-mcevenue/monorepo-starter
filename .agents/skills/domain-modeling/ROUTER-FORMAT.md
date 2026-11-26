# ROUTER.md Format

A router is a folder's entry point. Its job is navigation: an agent reads it on entering the folder and decides where to go next, so it stays short enough to read in full.

## Structure

```md
# {Folder Name}

{Optional: a line or two orienting an agent inside this folder.}

- [GLOSSARY.md](./GLOSSARY.md): terms specific to finance. Read before naming a concept here.
- [_adrs/](./_adrs/): decisions specific to finance. Read those touching your area.
- [bookkeeping/](./bookkeeping/ROUTER.md): ledgers and reconciliations. Open for anything about recording transactions.
```

The root router keeps its domains under a `## Domains` heading.

## Rules

- **Immediate children only.** One line per file or folder directly inside this folder: what it holds and when to open it. What lies deeper is the child router's job.
- **The orientation never restates the parent's line.** The parent already says when to open this folder; the orientation helps once inside.
- **Relative Markdown links** (`[bookkeeping/](./bookkeeping/ROUTER.md)`), never bare paths, so a link checker can verify them. A subfolder with its own router links to that router.
- **Updated in the same change.** Adding, renaming or removing a child updates this router in the same commit.

## Which folders have one

- `ai-docs/` and every domain: always.
- A subfolder inside a domain: once it contains subfolders of its own, unless the domain's mode documents a fixed layout for it. The domain's top router then points at that layout.
