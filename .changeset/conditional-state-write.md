---
"@bedrock-rbx/core": minor
---

Make the **State** write conditional on the **State** that was read. `StatePort.read` now returns a `StateRecord` carrying the **State** it found under `state` and, under `version`, the `StateVersion` naming that exact record: `{ kind: "present", token }` for a record that existed, `{ kind: "absent" }` for an **Environment** a versioned **Backend** has never had deployed. `StatePort.write` takes that version as an optional second argument and fails with a `stateConflict` rather than overwriting a record that moved in between, including the case where a record appeared after a read that found none.

This is the fencing token, and it is worth having before any locking exists: it turns a silently lost write into a detectable conflict. A conflict surfaces through the existing `stateWriteFailed` path, so the resources that were applied but never recorded reach the operator along with the unsaved snapshot and the `bedrock state push` recovery command; it is never retried into an overwrite.

A **Backend** whose store has no version primitive carries no `version`, which makes its writes unconditional. The builtin gist **Backend** does exactly that and is otherwise unchanged.

A `StatePort` implementation must now return `{ state }` (or `{}`) from `read` rather than the **State** itself, and a caller reading through the port reaches the snapshot at `read.data.state`. A `write` that ignores its second argument keeps overwriting as before.
