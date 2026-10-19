# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues at
`christopher-buss/bedrock`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a
  heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by
  `jq` and also fetching labels.
- **List issues**:
  `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`
  with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` /
  `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run
inside a clone.

## Issue relationships

GitHub issue dependencies and sub-issues are native relationships, not body
text. Use them so they render in the Relationships sidebar, the Issues tab, and
projects. There is no `gh issue` subcommand for these; use `gh api graphql`.

Both mutations take GraphQL node IDs, not issue numbers. Resolve a number to its
node ID with `gh issue view <number> --json id --jq .id`.

- **Mark blocked by** (this issue depends on a blocker):

  ```bash
  gh api graphql -f query='mutation($id:ID!,$blocker:ID!){addBlockedBy(input:{issueId:$id,blockingIssueId:$blocker}){issue{number}}}' -f id=<blocked node id> -f blocker=<blocking node id>
  ```

- **Set parent** (attach this issue as a sub-issue of its parent):

  ```bash
  gh api graphql -f query='mutation($parent:ID!,$child:ID!){addSubIssue(input:{issueId:$parent,subIssueId:$child}){issue{number}}}' -f parent=<parent node id> -f child=<child node id>
  ```

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external
PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using
the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for
  the diff.
- **List external PRs for triage**:
  `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`
  then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`,
  or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/
  `--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be
either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## Wayfinding operations

Used by `/wayfinder`. A map is an issue labelled `wayfinder:map`; its tickets
are its native sub-issues, each carrying exactly one `wayfinder:<type>` label
(`research`, `prototype`, `grilling`, `task`). The labels are defined in
`.github/labels.yaml`.

The REST endpoints take the issue's database `id`, not its number, as a JSON
integer. Pass the body with `--input -`: `-F` sends a large id as a string.

- **Issue id**: `gh api repos/{owner}/{repo}/issues/<number> --jq .id`
- **Create a map**:
  `gh issue create --label wayfinder:map --title "..." --body-file <file>`
- **Create a ticket**:
  `gh issue create --label wayfinder:<type> --title "..." --body-file <file>`,
  then add it to the map.
- **Add a ticket to a map**:
  `echo '{"sub_issue_id": <ticket id>}' | gh api -X POST repos/{owner}/{repo}/issues/<map>/sub_issues --input -`
- **Block a ticket**:
  `echo '{"issue_id": <blocker id>}' | gh api -X POST repos/{owner}/{repo}/issues/<blocked>/dependencies/blocked_by --input -`
- **List a map's tickets**, in map order:
  `gh api repos/{owner}/{repo}/issues/<map>/sub_issues --paginate --jq '.[] | {number, title, state, labels: [.labels[].name], assignees: [.assignees[].login], open_blockers: .issue_dependencies_summary.blocked_by}'`
- **Frontier**: the map's open sub-issues with no assignee and
  `open_blockers == 0` (`issue_dependencies_summary.blocked_by` counts open
  blockers only). The first in map order wins.
- **Claim**: `gh issue edit <ticket> --add-assignee @me`, the session's first
  write.
- **Resolve**: `gh issue comment <ticket> --body-file <file>` with the answer,
  then `gh issue close <ticket>`, then append one line to the map's "Decisions
  so far": `- [<ticket title>](<ticket url>): <gist>`. Rewrite the map with
  `gh issue edit <map> --body-file <file>` from a fresh `gh issue view <map>`,
  since other sessions edit it concurrently.
- **Rule out of scope**: `gh issue close <ticket> --reason "not planned"`, then
  append `- [<ticket title>](<ticket url>): <gist>, <why>` to the map's "Out of
  scope".
