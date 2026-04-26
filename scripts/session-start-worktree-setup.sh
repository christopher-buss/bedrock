#!/bin/zsh -l
# Workaround for anthropics/claude-code#29716 — Claude Code Desktop's
# "create in worktree" UI does not fire WorktreeCreate hooks. SessionStart
# fires reliably in both desktop and CLI environments, so we run the
# worktrunk post-create chain (mise trust, mise install, pnpm install) here
# whenever a session starts in a fresh worktree without node_modules.

set -e

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# In a worktree, git-dir points at .git/worktrees/<name>; in the main repo
# it equals git-common-dir. Skip the main-repo case so this hook is a
# no-op outside worktree sessions.
git_dir=$(git rev-parse --git-dir)
common_dir=$(git rev-parse --git-common-dir)
if [ "$(cd "$git_dir" && pwd)" = "$(cd "$common_dir" && pwd)" ]; then
  exit 0
fi

[ -d node_modules ] && exit 0

exec wt hook post-create --yes
