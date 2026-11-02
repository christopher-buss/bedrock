#!/usr/bin/env bash
# Exercise the real workflow publish block; no network or package publishing.
set -euo pipefail
cd "$(dirname "$0")/../.."

test_root=$(cd "${TMPDIR:-/tmp}" && pwd -P)
test_dir=$(mktemp -d "$test_root/release-gate.XXXXXX")
case "$test_dir" in "$test_root"/release-gate.*) ;; *) exit 1 ;; esac
trap 'rm -rf "$test_dir"' EXIT
export TEST_RELEASE_GATE_DIR="$test_dir"
export GITHUB_REPOSITORY=example/release-gate-dry-run
export GH_TOKEN=not-a-real-token
export GITHUB_SHA=event-sha-is-not-checkout-identity
export DIST_TAG=dry-run
export TEST_RELEASE_GATE_SHA
TEST_RELEASE_GATE_SHA=$(git rev-parse HEAD)

# Read the command GitHub will execute, including the original inline form.
workflow_command() {
  awk -v name="$1" '
  $0 == ("        name: " name) { found = 1; next }
  found && /^        run: / {
    if ($0 !~ /run: \|$/) { sub(/^        run: /, ""); print; exit }
    block = 1; next
  }
  block && /^          / { sub(/^          /, ""); print; next }
  block && /^[[:space:]]*$/ { print; next }
  block { exit }
' .github/workflows/release.yaml
}
workflow_command 'Publish to npm' > "$test_dir/publish.sh"
test -s "$test_dir/publish.sh"

# Exported functions shadow installed commands even in the gate's bash.
# Snapshots are gh api --paginate --slurp responses, one per request.
gh() {
  printf '%s\n' "$*" >> "$TEST_RELEASE_GATE_DIR/api.log"
  if [ "$1" = workflow ]; then return 0; fi
  local call
  local -a snapshots
  read -r call < "$TEST_RELEASE_GATE_DIR/call"
  mapfile -t snapshots < "$TEST_RELEASE_GATE_DIR/responses.jsonl"
  echo "$((call + 1))" > "$TEST_RELEASE_GATE_DIR/call"
  # Keep regressions in the production wait loop bounded in the harness too.
  if ((call > ${#snapshots[@]})); then return 1; fi
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
  local result_var="$1"
  shift
  printf -v "$result_var" '{"id":%s,"head_sha":"%s","head_branch":"%s","event":"%s","status":"%s","conclusion":%s,"updated_at":"%s"}' \
    "${4:-100}" "${3:-$TEST_RELEASE_GATE_SHA}" "${7:-main}" "${6:-push}" \
    "$1" "$2" "${5:-2026-10-25T12:00:00Z}"
}
snapshot() {
  local result_var="$1"
  shift
  local IFS=,
  printf -v "$result_var" '[{"workflow_runs":[%s]}]' "$*"
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

# Fixture output parameters are assigned by printf -v in the helpers above.
declare success='' failure='' passed='' failed='' wrong_commit='' wrong_commit_response=''
declare new_failure='' stale='' queued_run='' pending_run='' active_run=''
declare queued='' pending='' active='' new_success='' inflight='' pr_success='' pr_response=''
declare dispatched_failure='' dispatched_response=''
declare terminal='' terminal_response='' empty='' requested_run='' waiting_run=''
declare requested='' waiting='' recovered='' rerun_failure='' rerun='' pages='' unknown=''
run_json success completed '"success"'
run_json failure completed '"failure"'
snapshot passed "$success"
snapshot failed "$failure"
run_case failed-smoke blocked "$failed"
run_case passed-smoke publish "$passed"
run_json wrong_commit completed '"success"' a-different-commit
snapshot wrong_commit_response "$wrong_commit"
run_case different-commit blocked "$wrong_commit_response"
run_json new_failure completed '"failure"' "$TEST_RELEASE_GATE_SHA" 101 2026-10-25T12:01:00Z
snapshot stale "$success" "$new_failure"
run_case newer-failure blocked "$stale"
run_json queued_run queued null
run_json pending_run pending null
run_json active_run in_progress null
snapshot queued "$queued_run"
snapshot pending "$pending_run"
snapshot active "$active_run"
run_case queued-smoke publish "$queued" "$pending" "$active" "$passed"
run_json new_success completed '"success"' "$TEST_RELEASE_GATE_SHA" 101 2026-10-25T12:01:00Z
snapshot inflight "$pending_run" "$new_success"
run_case inflight-over-success timeout "$inflight"
run_json pr_success completed '"success"' "$TEST_RELEASE_GATE_SHA" 102 2026-10-25T12:02:00Z pull_request
snapshot pr_response "$pr_success"
run_case pr-smoke timeout "$pr_response"
run_json dispatched_failure completed '"failure"' "$TEST_RELEASE_GATE_SHA" 103 2026-10-25T12:03:00Z workflow_dispatch changeset-release/main
snapshot dispatched_response "$success" "$dispatched_failure"
run_case later-dispatch-failure blocked "$dispatched_response"

for conclusion in cancelled skipped timed_out neutral action_required stale startup_failure null; do
  if [ "$conclusion" = null ]; then
    run_json terminal completed null
  else
    run_json terminal completed "\"$conclusion\""
  fi
  snapshot terminal_response "$terminal"
  run_case "smoke-$conclusion" blocked "$terminal_response"
done
snapshot empty
run_case no-smoke timeout "$empty"
run_case queued-timeout timeout "$queued"
run_case running-timeout timeout "$active"
run_json requested_run requested null
run_json waiting_run waiting null
snapshot requested "$requested_run"
snapshot waiting "$waiting_run"
run_case delayed-smoke publish "$empty" "$requested" "$waiting" "$active" "$passed"
snapshot recovered "$failure" "$new_success"
run_case newer-success publish "$recovered"
run_json rerun_failure completed '"failure"' "$TEST_RELEASE_GATE_SHA" 99 2026-10-25T12:05:00Z
snapshot rerun "$new_success" "$rerun_failure"
run_case older-run-rerun-failure blocked "$rerun"
printf -v pages '[{"workflow_runs":[%s]},{"workflow_runs":[%s]}]' "$success" "$new_failure"
run_case paginated-failure blocked "$pages"
run_json terminal completed '"success"' "$TEST_RELEASE_GATE_SHA" 104 2026-10-25T12:06:00Z workflow_dispatch changeset-release/main
snapshot terminal_response "$terminal"
run_case dispatched-success publish "$terminal_response"
run_json terminal unrecognised null
snapshot unknown "$terminal"
run_case unknown-status blocked "$unknown"
run_case api-error blocked api-error
run_case malformed-api blocked not-json

if [ "${RELEASE_GATE_TEST_CASE:-version-dispatch}" = version-dispatch ]; then
  rm -f "$test_dir/api.log"
  export RELEASE_BRANCH=changeset-release/main
  workflow_command 'Trigger CI and smoke on the release branch' > "$test_dir/dispatch.sh"
  test -s "$test_dir/dispatch.sh"
  bash -euo pipefail "$test_dir/dispatch.sh"
  expected=$'workflow run ci.yaml --ref changeset-release/main\nworkflow run smoke.yaml --ref changeset-release/main'
  if [ "$(< "$test_dir/api.log")" != "$expected" ]; then
    echo 'FAIL: Version PR creation/refresh did not dispatch both CI and smoke on its branch' >&2
    exit 1
  fi
  echo 'PASS: Version PR creation/refresh dispatches CI and smoke on its branch'
fi

if [ "${RELEASE_GATE_TEST_CASE:-workflow-pinning}" = workflow-pinning ]; then
  if ! grep -Fxq "          ref: \${{ github.sha }}" .github/workflows/release.yaml; then
    echo 'FAIL: release checkout is not pinned to the event commit' >&2
    exit 1
  fi
  grep -Fxq "    if: github.ref == 'refs/heads/main'" .github/workflows/release.yaml
  grep -Fxq '        run: bash .github/scripts/test-release-gate.sh' .github/workflows/ci.yaml
  echo 'PASS: release checkout is pinned on main and CI exercises the publishing seam'
fi

# Replay an old event after main advanced and a newer Version PR was cut.
# Only the remote is substituted: the workflow runs its actual reset/PR commands
# against a disposable local repository, with gh stubbed at the API boundary.
version_case() (
  local label="$1" revision="$2" result=0
  if [ "${RELEASE_GATE_TEST_CASE:-$label}" != "$label" ]; then return; fi
  export HK=0
  local case_dir="$test_dir/$label"
  mkdir "$case_dir"
  workflow_command 'Reset release branch to base' > "$case_dir/version.sh"
  workflow_command 'Open or refresh the Version PR' >> "$case_dir/version.sh"
  test -s "$case_dir/version.sh"
  git init --bare -q "$case_dir/remote.git"
  git -C "$case_dir/remote.git" config core.hooksPath /dev/null
  git init -q "$case_dir/checkout"
  cd "$case_dir/checkout"
  git config core.hooksPath /dev/null
  export GIT_AUTHOR_NAME=release-test GIT_AUTHOR_EMAIL=release-test@example.invalid
  export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
  local tree old current bump
  tree=$(git hash-object -t tree --stdin </dev/null)
  old=$(echo old-main | git commit-tree "$tree")
  current=$(echo current-main | git commit-tree "$tree" -p "$old")
  bump=$(echo newer-version-bump | git commit-tree "$tree" -p "$current")
  git remote add origin "$case_dir/remote.git"
  git push -q origin "$current:refs/heads/main" "$bump:refs/heads/changeset-release/main"
  if [ "$revision" = old ]; then git checkout -q --detach "$old"; else git checkout -q --detach "$current"; fi
  export RELEASE_BRANCH=changeset-release/main
  export VERSION_PR_LOG="$case_dir/pr.log"
  export GITHUB_RUN_ID=4242
  gh() { printf '%s\n' "$*" >> "$VERSION_PR_LOG"; echo 1; }
  # A real cancel stops the runner during this sleep; the stub returns at once
  # so the step's fallback failure proves no later command ran.
  sleep() { :; }
  export -f gh sleep
  bash -euo pipefail "$case_dir/version.sh" > "$case_dir/output.log" 2>&1 || result=$?
  local remote_release
  remote_release=$(git ls-remote origin "refs/heads/$RELEASE_BRANCH" | cut -f1)
  if [ "$revision" = old ]; then
    if [ "$result" -eq 0 ] || [ "$remote_release" != "$bump" ] ||
      [ "$(< "$VERSION_PR_LOG")" != "run cancel $GITHUB_RUN_ID" ]; then
      cat "$case_dir/output.log"
      echo 'FAIL: stale version rerun changed the newer release branch or PR' >&2
      exit 1
    fi
  else
    test "$result" -eq 0
    test "$remote_release" = "$current"
    test -s "$VERSION_PR_LOG"
  fi
  echo "PASS: $label"
)
version_case stale-version-rerun old
version_case current-version-run current
