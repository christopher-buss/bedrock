#!/usr/bin/env bash
# Only real smoke for the checked-out commit can authorize npm publishing.
set -euo pipefail

sha=$(git rev-parse HEAD)
run=$(gh api --paginate --slurp \
  "repos/$GITHUB_REPOSITORY/actions/workflows/smoke.yaml/runs?head_sha=$sha&per_page=100" \
  | jq -r --arg sha "$sha" '
    [.[] .workflow_runs[] | select(.head_sha == $sha)]
    | first | [.status, .conclusion] | @tsv')
if [ "$run" != $'completed\tsuccess' ]; then
  echo "::error::Smoke did not succeed for $sha: $run"
  exit 1
fi
echo "Smoke passed for checked-out commit $sha"
