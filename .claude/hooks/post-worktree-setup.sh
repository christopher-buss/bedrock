#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)

worktree=$(printf '%s' "$payload" | jq -r '
  .tool_response.path // .tool_response.worktreePath //
  .tool_response.cwd  // .tool_response.directory   // empty
')

if [ -z "$worktree" ] || [ ! -d "$worktree" ]; then
  worktree=$(ls -1dt "${CLAUDE_PROJECT_DIR:?}"/.claude/worktrees/*/ 2>/dev/null | head -1)
  worktree=${worktree%/}
fi

if [ -z "$worktree" ] || [ ! -d "$worktree" ]; then
  echo "post-worktree-setup: could not locate new worktree path" >&2
  exit 0
fi

cd "$worktree"
echo "post-worktree-setup: setting up $worktree" >&2

mise trust
mise install
pnpm install
