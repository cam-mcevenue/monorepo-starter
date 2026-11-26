# Wayfinding operations

How `/wayfinder` keeps its map on GitHub Issues. Map and ticket issues carry only `wayfinder:` labels, never a type or state label: they hold decisions, not implementation work, so they stay off the work queue.

- **Map**: one issue holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map ...`.
- **Ticket**: a sub-issue of the map, labelled `wayfinder:<type>` (`research`, `prototype`, `grilling`, `task`). `gh issue create --parent <map> --label wayfinder:<type> ...`.
- **Blocking**: native blocking, as in **Blocking** in [SKILL.md](SKILL.md#commands).
- **Frontier**: the map's open sub-issues (`gh issue view <map> --json subIssues --jq '.subIssues.nodes[] | select(.state == "OPEN") | .number'`), minus any with an open blocker or an assignee. The first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write on the ticket.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n> --reason completed`, then append a context pointer (gist + link) to the map's Decisions-so-far.
