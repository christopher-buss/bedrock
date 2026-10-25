#!/usr/bin/env bash
# Only real smoke for the checked-out commit can authorize npm publishing.
set -euo pipefail

sha=$(git rev-parse HEAD)
# Smoke has a ten-minute job timeout and shares a serialized queue with other
# refs. Allow forty minutes here; the publishing step and job bound API stalls.
deadline=$((SECONDS + 2400))
while ((SECONDS < deadline)); do
  run=$(gh api --paginate --slurp \
    "repos/$GITHUB_REPOSITORY/actions/workflows/smoke.yaml/runs?head_sha=$sha&per_page=100" \
    | jq -r --arg sha "$sha" '
      # PR runs may test a synthetic merge commit. Push and dispatch runs
      # check out head_sha itself, regardless of the ref name.
      [.[] .workflow_runs[] | select(.head_sha == $sha
        and (.event == "push" or .event == "workflow_dispatch"))]
      # An in-flight attempt cannot be hidden by a completed success. Among
      # completed runs, updated_at also accounts for reruns of an older run.
      | ((map(select(.status != "completed")) | max_by([.updated_at, .id]))
        // max_by([.updated_at, .id]))
      | [.status // "missing", .conclusion // "none"] | @tsv')
  IFS=$'\t' read -r status conclusion <<< "$run"
  echo "Smoke for $sha: $status ($conclusion)"
  case "$status" in
    completed)
      if [ "$conclusion" = success ]; then
        echo "Smoke passed for checked-out commit $sha"
        exit 0
      fi
      echo "::error::Smoke did not succeed for $sha: $conclusion"
      exit 1
      ;;
    missing|queued|pending|requested|waiting|in_progress) sleep 30 ;;
    *) echo "::error::Unrecognised smoke status for $sha: $status"; exit 1 ;;
  esac
done
echo "::error::Timed out waiting for smoke success for checked-out commit $sha"
exit 1
