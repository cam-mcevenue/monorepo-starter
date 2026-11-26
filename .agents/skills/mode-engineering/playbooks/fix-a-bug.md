### Fix a bug

**Find the cause before the fix, end at a PR.** The input is an issue number or a described symptom, and performance regressions count.

1. Given an issue number, fetch the issue first. Start on a new branch off `main`, unless you're already on a working branch.
2. Diagnose and fix it with **diagnosing-bugs**, through its cleanup phase. It owns the feedback loop, the regression test and the fix.
3. Review the change with **code-review**.
4. Write the PR body with **pr**.
5. Offer **retro**, to ask what would have prevented the bug.

**Reply:** what was broken, the root cause, the fix, and the repro output pasted verbatim, failing then passing.
