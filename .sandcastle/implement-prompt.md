# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run tests.

## CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

## PLAN

The designer has written a plan for this task at `{{PLAN_PATH}}`. Read it first:

!`cat {{PLAN_PATH}}`

The plan is canonical. Follow its slice breakdown. Pull the issue (`gh issue view {{TASK_ID}}`) or parent PRD only if you need detail the plan does not cover.

Do NOT delete or modify `{{PLAN_PATH}}`. The reviewer needs it intact. The file is gitignored and ESLint-ignored; if a tool flags it, that is a configuration bug to report, not a reason to remove the plan.

## EXPLORATION

After reading the plan, explore the sibling code and test files it points at. Pay extra attention to test files that touch the relevant parts of the code.

## EXECUTION

Use TDD per `CLAUDE.md` and `docs/adr/003-testing-strategy.md`. For each
behaviour slice in the plan:

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

- `hk check` to run the pre-commit hook checks (lint, typecheck, test, build)

## COMMIT FORMAT

Commit messages must follow the bedrock conventional-commit rules (see
`CLAUDE.md` "Pull Requests" section):

1. `type(scope): subject` shape, kebab-case subject, no em-dashes
2. Scope from the enum (`core, deps, e2e, global, ocale, testing,
   tsconfig, vite, website`) or omitted; `chore`/`build`/`docs`/`ci`/
   `refactor` are types, not scopes
3. Consumer-useful subject describing the change, not the iteration

Keep each commit message concise.

## THE ISSUE

If the task is not complete, leave a comment on the issue with what was done.
Give attribution to claude code for work done, do not claim it as the user's own
work.

Do not close the issue - this will be done later.
Do not push the branch or open a PR - the reviewer handles that.

Once complete, output <promise>COMPLETE</promise>.

## FINAL RULES

ONLY WORK ON A SINGLE TASK.
