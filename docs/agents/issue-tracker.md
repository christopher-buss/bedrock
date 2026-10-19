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
