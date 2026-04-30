# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view {{TASK_ID}}`. If it has a parent PRD, pull that in too.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run tests.

## CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

## EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

## EXECUTION

Use TDD per `CLAUDE.md` and `docs/adr/003-testing-strategy.md`. For each
behaviour slice:

1. RED: write one failing test for the slice
2. GREEN: write the minimum implementation to pass it
3. Commit RED + GREEN together (the pre-commit hook `hk` rejects pure
   RED, so they must land in the same commit)
4. REFACTOR if it adds value for that slice, then commit the refactor
   separately
5. Repeat for the next slice

Every line of production code in a commit must be exercised by a test in
that same commit. No premature scaffolding.

## FEEDBACK LOOPS

Before each commit, run:

- `pnpm gen:example-tests` if you touched any `@example` JSDoc blocks on
  symbols exported from a package's `src/index.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm mutate:changed` if you touched files under `src/**` (no
  surviving mutants; never silence with `// Stryker disable`)

The pre-commit hook runs lint, typecheck, test, and build, so a failing
gate blocks the commit.

## COMMIT FORMAT

Commit messages must follow the bedrock conventional-commit rules (see
`CLAUDE.md` "Pull Requests" section):

1. `type(scope): subject` shape, kebab-case subject, no em-dashes
2. Scope from the enum (`core, deps, e2e, global, ocale, testing,
   tsconfig, vite, website`) or omitted; `chore`/`build`/`docs`/`ci`/
   `refactor` are types, not scopes
3. Consumer-useful subject describing the change, not the iteration

Keep each commit message concise.

## SIMPLIFY

Once every behaviour slice is implemented and committed, run the
`/simplify` skill to review the cumulative changes for reuse, quality,
and efficiency. Action any improvements it surfaces and commit them
(separate commit, same conventions).

## PUSH AND OPEN PR

After SIMPLIFY:

1. Push the branch: `git push -u origin {{BRANCH}}`
2. Open a PR with `gh pr create`, including:
   - A title matching the commit conventions above
   - `Closes #{{TASK_ID}}` in the body so the issue auto-closes on merge
   - The `sandcastle` label so triage marks the PR `skip-review`
     (we already ran a review stage in the sandbox):
     `gh pr create --label sandcastle --title "..." --body "..."`

If the task is not complete, leave a comment on the issue with what was
done and do not open a PR.

Once complete, output <promise>COMPLETE</promise>.

## FINAL RULES

ONLY WORK ON A SINGLE TASK.
