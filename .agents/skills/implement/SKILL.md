---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use `/tdd` for all work, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use `/simplify` and `/code-review` to review the work.

Commit your work to the current branch religiously. The history should show the work in small, working steps, not one big commit at the end. Use conventional commit messages.

Run `/create-pr` to create a draft PR for the work when done.
