### Build a feature

**Build from an issue, end at a PR.** The input is an issue number, or a grilling in this session that **Spec a feature** handed over.

1. Start on a new branch off `main`, unless you're already on a working branch.
2. Route on the input:
   - **A spec with no tickets:** split it with **to-tickets**, then build it with **implement-spec**.
   - **A spec with tickets:** build it with **implement-spec**.
   - **One ticket:** build it with **implement**.
   - **A grilling in this session, with no issue:** build it with **implement**, with the grilling as its spec. When **code-review** asks where the spec is, point it at the conversation.
3. Write the PR body with **pr**. For **implement-spec**, that's the body of the PR it marks ready.
4. When the build went sideways, offer **retro**.

**Reply:** the PR link, what was built, what you chose and why, and any **code-review** findings left unfixed.
