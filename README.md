# Bedrock

## Setup

This repo uses [worktrunk](https://worktrunk.dev) (`wt`) for worktree
management. Install it once per machine:

```bash
brew install max-sixty/tap/worktrunk
# or: cargo install worktrunk
```

Worktrees created via `wt switch --create <branch>`, `claude -w`, or
the Claude Code desktop app's "new session in new worktree" flow run
the `post-create` hooks defined in [`.config/wt.toml`](.config/wt.toml)
(currently `mise install` + `pnpm install`).
