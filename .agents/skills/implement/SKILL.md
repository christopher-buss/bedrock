---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

You orchestrate: delegate code changes to `builder` agents.

Before delegating, read `CLAUDE.md`. Resume follow-ups from the recorded review and verification state.

1. Build. Brief a builder with the spec, the test level for each behavior (`CLAUDE.md`, "Test levels"), and the seams it may inject. It uses /tdd for new behavior and bug fixes at pre-agreed seams, runs `pnpm typecheck` and focused tests, and commits meaningful working increments as Conventional Commits.
2. Simplify. Read the diff. When it repays cleanup, have a builder run /simplify.
3. Review. Run /code-review once for the completed scope. Resolve its base to a fixed merge-base SHA. When the scope includes pending work, pass `git diff <baseline-sha>` plus the relevant files from `git ls-files --others --exclude-standard`, and name uncommitted changes apart from the reviewed SHA. Spawn both review sub-agents as the `reviewer` agent.
4. Fix. Group actionable findings and brief a fresh builder to make minimal fixes that match the surrounding code. Do not simplify or review again: confirm each finding is addressed in the diff, and verify affected behavior with typechecks and tests.
5. Verify. `pnpm lint`, `pnpm typecheck`, `pnpm lint:unused`, `pnpm build`, `pnpm test`, and `pnpm mutate:changed` must pass. Reuse an equivalent successful hook run. Run /create-pr to create a draft PR, or update the existing PR for a follow-up.

Run through this flow fully autonomously without manual intervention. You are done when the requested scope is verified and the pull request reflects it.
