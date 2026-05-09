# TASK

Polish, review, and ship the changes on branch `{{BRANCH}}` for issue {{TASK_ID}}: {{ISSUE_TITLE}}.

You are the sandcastle reviewer. The implementer was a smaller model working from a plan; you have full Opus context plus `CLAUDE.md` and the project's ADRs at your disposal. Be thorough.

## CONTEXT

### Plan

The designer wrote this plan, which the implementer followed:

!`cat {{PLAN_PATH}}`

### Branch diff

!`git diff {{SOURCE_BRANCH}}...{{BRANCH}}`

### Commits on this branch

!`git log {{SOURCE_BRANCH}}..{{BRANCH}} --oneline`

### Shared review rubric

This is the same rubric the CI Claude reviewer applies on opened PRs. Walk every section.

!`cat .claude/prompts/review-prompt.md`

### Project context

`CLAUDE.md` is auto-loaded by Claude Code. Apply its conventions throughout. Skim ADRs in `docs/adr/` referenced by the plan or that touch the package(s) being modified, plus any per-package `CONTEXT.md`.

## SIMPLIFY

Run the `/simplify` skill on the cumulative changes. It reviews the diff for reuse, quality, and efficiency and applies fixes via sub-agents. Action any improvements it surfaces and commit them as separate commits in conventional-commit format.

## REVIEW

After simplify, walk the shared rubric loaded above. Make corrections directly on the branch; each correction is its own commit, with `hk check` before each commit.

In addition to the shared rubric, evaluate plan adherence:

- Did the implementer build what the plan specified? Walk each slice in `{{PLAN_PATH}}` and confirm a matching test plus implementation landed.
- Are non-goals respected? Flag any code added that the plan said NOT to add.
- Are the plan's open questions resolved? If the plan flagged a decision the designer couldn't make, decide it now.
- If the implementer skipped, misread, or partially completed a slice, fix it.

## PUSH AND OPEN PR

Once review changes are committed:

1. Push the branch: `git push -u origin {{BRANCH}}`
2. Open a PR with `gh pr create`. Include:
   - A title following the bedrock commitlint rules (kebab-case subject after `type(scope):`, scope from the enum, no em-dashes; consumer-useful phrasing per `CLAUDE.md` "Pull Requests")
   - `Closes #{{TASK_ID}}` in the body so the issue auto-closes on merge
   - The `sandcastle` label so triage marks the PR `skip-review`:
     `gh pr create --label sandcastle --title "..." --body "..."`

## CI VERIFICATION

Before declaring the work complete:

1. `gh pr checks --watch`
2. If any check fails, diagnose with `gh run view <id> --log-failed`, fix it, run `hk check`, commit, and push.
3. Repeat until all checks pass.

Do not output COMPLETE until CI is fully green.

Once complete, output <promise>COMPLETE</promise>.
