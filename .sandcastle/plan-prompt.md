# ISSUES

Here are the open issues in the repo:

<issues-json>

!`gh issue list --state open --label ready-for-agent --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

</issues-json>

## OPEN SANDCASTLE PRS

Here are the open PRs already opened by sandcastle (these are still in
flight; do not pick the issues they reference, even if those issues are
still open):

<open-prs-json>

!`gh pr list --state open --label sandcastle --json number,title,body,headRefName --jq '[.[] | {number, title, headRefName, body}]'`

</open-prs-json>

## TASK

First, **exclude** any issue whose number appears in a `Closes #N`,
`Fixes #N`, or `Resolves #N` reference in the body of an open
sandcastle PR above. Those issues are already being worked on; picking
them again would duplicate effort and conflict on the same branch.

For the remaining open issues, analyze and build a dependency graph.
For each issue, determine whether it **blocks** or **is blocked by**
any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the format `sandcastle/issue-{id}-{slug}`.

## OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42-fix-auth-bug"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).
