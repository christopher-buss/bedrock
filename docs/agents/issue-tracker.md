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

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. A map is an issue labelled `wayfinder:map`; its tickets
are its native sub-issues, each labelled `wayfinder:<type>` (`research`,
`prototype`, `grilling`, `task`). The labels are defined in
`.github/labels.yaml`.

The REST endpoints take the issue's database `id`, not its number, as a JSON
integer. Pass the body with `--input -`: `-F` sends a large id as a string.

- **Issue id**: `gh api repos/{owner}/{repo}/issues/<number> --jq .id`
- **Add a ticket to a map**:
  `echo '{"sub_issue_id": <ticket id>}' | gh api -X POST repos/{owner}/{repo}/issues/<map>/sub_issues --input -`
- **Block a ticket**:
  `echo '{"issue_id": <blocker id>}' | gh api -X POST repos/{owner}/{repo}/issues/<blocked>/dependencies/blocked_by --input -`
- **List a map's tickets**:
  `gh api repos/{owner}/{repo}/issues/<map>/sub_issues --jq '.[] | {number, title, state, assignees: [.assignees[].login]}'`
- **List a ticket's blockers**:
  `gh api repos/{owner}/{repo}/issues/<ticket>/dependencies/blocked_by --jq '.[] | {number, title, state}'`
- **Frontier**: the map's open sub-issues with no assignee whose blockers are
  all closed.
- **Claim**: `gh issue edit <ticket> --add-assignee <dev>`, before any work.
- **Resolve**: `gh issue close <ticket> --comment "<resolution>"`, then append
  one line to the map's "Decisions so far" with
  `gh issue edit <map> --body-file`.
