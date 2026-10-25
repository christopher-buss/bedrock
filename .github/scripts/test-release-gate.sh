#!/usr/bin/env bash
# Exercise the real workflow publish block; no network or package publishing.
set -euo pipefail
cd "$(dirname "$0")/../.."

test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
export TEST_RELEASE_GATE_DIR="$test_dir"
export GITHUB_REPOSITORY=example/release-gate-dry-run
export GH_TOKEN=not-a-real-token
export DIST_TAG=dry-run
export TEST_RELEASE_GATE_SHA
TEST_RELEASE_GATE_SHA=$(git rev-parse HEAD)

# Read the command GitHub will execute, including the initial inline form.
awk '
  /^        name: Publish to npm$/ { publish = 1; next }
  publish && /^        run: / {
    if ($0 !~ /run: \|$/) { sub(/^        run: /, ""); print; exit }
    block = 1; next
  }
  block && /^          / { sub(/^          /, ""); print; next }
  block { exit }
' .github/workflows/release.yaml > "$test_dir/publish.sh"
test -s "$test_dir/publish.sh"

# Exported shell functions shadow installed commands even in the gate's bash.
gh() {
  printf '%s\n' "$*" >> "$TEST_RELEASE_GATE_DIR/api.log"
  local call
  call=$(cat "$TEST_RELEASE_GATE_DIR/call")
  echo "$((call + 1))" > "$TEST_RELEASE_GATE_DIR/call"
  jq -s . "$TEST_RELEASE_GATE_DIR/response-$call.json"
}
pnpm() {
  printf '%s\n' "$*" >> "$TEST_RELEASE_GATE_DIR/publish.log"
}
sleep() { SECONDS=$((SECONDS + $1)); }
export -f gh pnpm sleep

reset_scenario() {
  rm -f "$test_dir"/response-*.json "$test_dir/publish.log" "$test_dir/api.log"
  echo 0 > "$test_dir/call"
}

run_response() {
  local conclusion="$1"
  jq -n --arg sha "$TEST_RELEASE_GATE_SHA" --arg conclusion "$conclusion" \
    '{workflow_runs: [{id: 100, head_sha: $sha, head_branch: "main", event: "push",
      status: "completed", conclusion: $conclusion, updated_at: "2026-10-25T12:00:00Z"}]}'
}

reset_scenario
run_response failure > "$test_dir/response-0.json"
if bash -euo pipefail "$test_dir/publish.sh" > "$test_dir/output.log" 2>&1; then
  cat "$test_dir/output.log"
  echo 'FAIL: deliberately failing smoke allowed publishing' >&2
  exit 1
fi
test ! -e "$test_dir/publish.log"
cat "$test_dir/output.log"
echo 'PASS: deliberately failing smoke prevented publishing'

reset_scenario
run_response success > "$test_dir/response-0.json"
bash -euo pipefail "$test_dir/publish.sh" > "$test_dir/output.log" 2>&1
test "$(cat "$test_dir/publish.log")" = 'publish -r --no-git-checks --tag dry-run'
cat "$test_dir/output.log"
echo 'PASS: successful smoke allowed the stub publish command'
