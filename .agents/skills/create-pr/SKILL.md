---
name: create-pr
description: "Open a GitHub pull request for the current work with `gh`, branching, committing, and pushing first if needed. Use when the user asks to open a PR, submit changes for review, or \"PR this\"."
---

Open a pull request for the current work, branching, committing, and pushing first if needed. Invoking this skill authorizes those steps: do them directly, without asking.

## 1. Get to a pushable feature branch

1. On the default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`)? Switch to a new `type/short-description` branch.
2. Commit any uncommitted changes. Touched a versioned package? Record a change intent with `pnpm change` first (see "Releases" in `CLAUDE.md`).
3. `git push -u origin HEAD`.

**Stop and ask** if the tree mixes unrelated edits or the push needs force.

**Done when** HEAD is a feature branch, the tree is clean, and the branch is on the remote.

## 2. Read the diff

```bash
git diff <base>...HEAD --name-status
git log <base>...HEAD --oneline
git diff <base>...HEAD
```

Capture every issue the commits reference (`#NNN`, `closes #NNN`, `fixes #NNN`).

**Done when** you can name the change type, the systems touched, and every referenced issue.

## 3. Title

```text
type(scope): imperative description
```

Conventional commit, derived from the diff, not the branch name. Follow the PR-title rules in `CLAUDE.md` (lower-case subject, scope-enum, consumer-useful subject). Issue references belong in the body, not the title.

The title becomes the changelog entry, so name the payoff a reader cares about rather than the mechanism:

BAD

> ❌ `perf(server): negotiate permessage-deflate on the websocket`

GOOD

> ✅ `perf(server): cut websocket frame size by 70%+ with gzipping`

## 4. Body

Call the Skill tool with "pr" for the body template. Write the body for a reviewer who has not read the conversation, applying these repository rules to its sections:

- **Summary**: open with the problem in one line, in the user's framing, before the view.
- **Evidence**: name the command or artifact and the revision it covers. Show the exact test that fails before and passes after. Never restate suite-wide test, coverage, or lint results; CI owns those.
- **Merge Danger**: for a one-way door, state the rollback condition, such as a coordinated consumer change or a migrated state file. Blast radius names the affected packages, commands, config, or state.

After the `pr` sections, add the references:

```markdown
## References

Closes #NNN
Parent: #NNN
```

`Closes #NNN` for each issue the PR resolves. Link a parent PRD with `Parent: #NNN`, or `Closes #NNN` when this is its final slice. Omit the section when no issue is referenced.

**Done when** every commit-referenced issue is accounted for in the body.

## 5. Credit every agent on the branch

A branch is often the work of more than one agent: one writes the code, another reviews or amends it. The commits record who, so read them rather than assuming the agent running this skill is the only one:

```bash
git log --format='%(trailers:key=Co-authored-by,valueonly)' <base>..HEAD | sort -u
```

The key matches case-insensitively, so this finds every spelling. Close the body with one line per agent found, and add nothing for an agent that left no commit:

| Trailer address         | Line                            |
| ----------------------- | ------------------------------- |
| `noreply@openai.com`    | `Generated with Codex.`         |
| `noreply@anthropic.com` | `🤖 Generated with Claude Code` |

Never drop a line another agent already put in the body when you update a PR.

**Done when** the body names every agent the trailers name, and no other.

## 6. Create

```bash
gh pr create --title "<title>" --body-file <body-file> --base <base>
```

Write the exact body to a temporary file first.

Base is the detected default branch. Open ready-for-review unless the changes are clearly WIP or the user asked for a draft, in which case add `--draft`. Honor any base or title the user supplied.

**Done when** `gh` returns the PR URL. Output it.
