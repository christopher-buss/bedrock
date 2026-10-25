#!/usr/bin/env bash
# Exercise the real workflow publish block; no network or package publishing.
set -euo pipefail
cd "$(dirname "$0")/../.."

test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
export TEST_RELEASE_GATE_DIR="$test_dir"
export GITHUB_REPOSITORY=example/release-gate-dry-run
export GH_TOKEN=not-a-real-token
export GITHUB_SHA=event-sha-is-not-checkout-identity
export DIST_TAG=dry-run
export TEST_RELEASE_GATE_SHA
TEST_RELEASE_GATE_SHA=$(git rev-parse HEAD)

# Read the command GitHub will execute, including the original inline form.
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

# Exported functions shadow installed commands even in the gate's bash.
# Snapshots are gh api --paginate --slurp responses, one per request.
gh() {
  printf '%s\n' "$*" >> "$TEST_RELEASE_GATE_DIR/api.log"
  local call
  local -a snapshots
  read -r call < "$TEST_RELEASE_GATE_DIR/call"
  mapfile -t snapshots < "$TEST_RELEASE_GATE_DIR/responses.jsonl"
  echo "$((call + 1))" > "$TEST_RELEASE_GATE_DIR/call"
  if ((call >= ${#snapshots[@]})); then call=$((${#snapshots[@]} - 1)); fi
  if [ "${snapshots[$call]}" = api-error ]; then return 1; fi
  printf '%s\n' "${snapshots[$call]}"
}
pnpm() {
  printf '%s\n' "$*" >> "$TEST_RELEASE_GATE_DIR/publish.log"
}
sleep() {
  local call
  local -a snapshots
  read -r call < "$TEST_RELEASE_GATE_DIR/call"
  mapfile -t snapshots < "$TEST_RELEASE_GATE_DIR/responses.jsonl"
  # Advance the clock to the deadline after the last supplied snapshot.
  if ((call >= ${#snapshots[@]})); then
    SECONDS=$((SECONDS + 2400))
  else
    SECONDS=$((SECONDS + $1))
  fi
  echo "$1" >> "$TEST_RELEASE_GATE_DIR/waits.log"
}
export -f gh pnpm sleep

run_json() {
  printf '{"id":%s,"head_sha":"%s","head_branch":"%s","event":"%s","status":"%s","conclusion":%s,"updated_at":"%s"}' \
    "${4:-100}" "${3:-$TEST_RELEASE_GATE_SHA}" "${7:-main}" "${6:-push}" \
    "$1" "$2" "${5:-2026-10-25T12:00:00Z}"
}
snapshot() {
  local IFS=,
  printf '[{"workflow_runs":[%s]}]' "$*"
}
run_case() {
  local label="$1" expected="$2" result=0 calls
  shift 2
  if [ "${1:-}" = '' ]; then echo 'Missing fake response' >&2; exit 1; fi
  if [ "${RELEASE_GATE_TEST_CASE:-$label}" != "$label" ]; then return; fi
  rm -f "$test_dir/publish.log" "$test_dir/api.log" "$test_dir/waits.log"
  printf '%s\n' "$@" > "$test_dir/responses.jsonl"
  echo 0 > "$test_dir/call"
  bash -euo pipefail "$test_dir/publish.sh" > "$test_dir/output.log" 2>&1 || result=$?
  if [ "$expected" = publish ]; then
    if [ "$result" -ne 0 ] || [ ! -e "$test_dir/publish.log" ] || [ "$(< "$test_dir/publish.log")" != 'publish -r --no-git-checks --tag dry-run' ]; then
      cat "$test_dir/output.log"
      echo "FAIL: $label did not authorize the stub publisher" >&2
      exit 1
    fi
  elif [ "$result" -eq 0 ] || [ -e "$test_dir/publish.log" ]; then
    cat "$test_dir/output.log"
    echo "FAIL: $label allowed publishing" >&2
    exit 1
  fi
  # A command failure must not mask a gate that never queried smoke at all.
  test -s "$test_dir/api.log"
  read -r calls < "$test_dir/call"
  test "$calls" -le "$#"
  if [ "$expected" = timeout ]; then
    [[ "$(< "$test_dir/output.log")" == *'Timed out'* ]]
    test -s "$test_dir/waits.log"
  fi
  cat "$test_dir/output.log"
  echo "PASS: $label (stub publishes: $([ -e "$test_dir/publish.log" ] && echo 1 || echo 0); API reads: $calls)"
}

success=$(run_json completed '"success"')
failure=$(run_json completed '"failure"')
run_case failed-smoke blocked "$(snapshot "$failure")"
run_case passed-smoke publish "$(snapshot "$success")"
run_case different-commit blocked "$(snapshot "$(run_json completed '"success"' a-different-commit)")"
run_case newer-failure blocked "$(snapshot "$success" "$(run_json completed '"failure"' "$TEST_RELEASE_GATE_SHA" 101 2026-10-25T12:01:00Z)")"
