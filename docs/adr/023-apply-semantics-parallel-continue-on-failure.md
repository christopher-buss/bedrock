# ADR-023: Apply Semantics — Parallel, Continue-on-Failure, Per-Op Progress Events

Date: 2026-05-14 Status: Proposed

Decision Makers: Maintainer
Tags: apply, deploy, progress, ports, diff, ux

## Context

`applyOps` ([packages/bedrock/src/shell/apply-ops.ts](../../packages/bedrock/src/shell/apply-ops.ts))
today runs reconciliation operations sequentially with **first-fail** semantics:
on the first driver error or `updateUnsupported`, remaining ops are abandoned
and the partial set already applied is persisted via the existing `appliedSoFar`
field on `ApplyError`. The state file is still updated with what succeeded
before the failure, but every operation queued behind the failing one never
runs — a future deploy is required to converge them.

Two issues motivated the redesign:

1. **Deterministic failures punish unrelated resources.** A `gamePass` whose
   driver lacks update support produces `updateUnsupported`, which is a
   capability gap, not a transient error. Bailing on it skips every other
   pending op even though none would have been affected. The user observed
   this concretely: `apply failed for 'gamepass': update not supported`,
   nothing else attempted.
2. **No per-resource progress visibility.** The `ProgressPort`
   ([packages/bedrock/src/ports/progress-port.ts](../../packages/bedrock/src/ports/progress-port.ts))
   currently emits a single `deploySuccess` or `deployFailure` event per
   environment. The port JSDoc explicitly anticipates per-resource event
   variants, but they do not yet exist. Users cannot tell mid-deploy what
   has reconciled and what has not.

Apply-time operations are independent for all current resource kinds. Universe,
GamePass, Place, and DeveloperProduct each bind `universeId` at driver
construction time
([game-pass-driver.ts:46](../../packages/bedrock/src/adapters/game-pass-driver.ts:46),
[developer-product-driver.ts:53](../../packages/bedrock/src/adapters/developer-product-driver.ts:53))
because Open Cloud cannot mint universes — they are adopted, not created. No
op produces an output that another op consumes within the same apply. Retry
and rate limiting are absorbed inside `@bedrock-rbx/ocale` per
[ADR-010](./010-sdk-managed-rate-limiting-and-retry.md); a failure surfaced to
apply has already exhausted retries.

## Decision

`applyOps` becomes parallel, continue-on-failure, and instrumented with
per-op `ProgressPort` events.

### Algorithm

1. Dispatch every non-noop op concurrently via
   `Promise.allSettled(ops.map(dispatchOp))`. `allSettled` (not `all`) is
   deliberate: a driver that throws outside its `Result` contract settles as
   a rejection for that op alone, without short-circuiting the in-flight
   batch.
2. Each dispatch emits `resourceOpStarted` before the driver call and
   `resourceOpSucceeded` or `resourceOpFailed` after it returns.
3. `noop` ops emit a single `resourceOpNoop` event (no dispatch, no driver call).
4. After all ops settle, return
   `Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>`:
   - **Ok** when no op failed; `applied[]` is in declaration order
     (`Promise.allSettled` preserves input order in its results array; we
     zip by index, not by completion time).
   - **Err** when one or more ops failed; the aggregate carries both the
     `applied` set and the `failures` list.
5. `deploy.runReconcile` writes the merged state regardless of whether any op
   failed (preserving today's "persist what succeeded" behaviour). It then
   emits `applySummary` unconditionally. `stateWritten` is emitted only when
   `statePort.write` returns `Ok`; on write failure, the existing
   `stateWriteFailed` error path runs and no `stateWritten` event fires.

### Wire / type changes

Pre-1.0, additive where possible, breaking only in shape — consumers do not
exist yet ([ADR-006](./006-adr-enforcement.md) rule 7).

```ts
// core/operations.ts
interface UpdateOperation extends BaseOperation {
	readonly changedFields: ReadonlyArray<string>; // NEW: populated by diff()
	readonly current: ResourceCurrentState;
	readonly desired: ResourceDesiredState;
	readonly type: "update";
}

// shell/apply-ops.ts
type ApplyError =
	| { cause: OpenCloudError; key: ResourceKey; kind: "driverFailure" }
	| { key: ResourceKey; kind: "updateUnsupported" };
//   appliedSoFar removed — moved up to AggregateApplyError.applied

interface AggregateApplyError {
	readonly applied: ReadonlyArray<ResourceCurrentState>; // in declaration order
	readonly failures: ReadonlyArray<ApplyError>; // 1..N
}

// shell/deploy.ts
interface DeployError {
	cause: AggregateApplyError;
	kind: "applyFailed";
} // CHANGED: aggregate, not single
/* other variants unchanged */
```

### Progress events

Additive on `ProgressEvent`. Clack adapter pattern-matches new variants;
`resourceOpStarted` and `resourceOpNoop` may be rendered or no-op'd by any
adapter.

```ts
type ProgressEvent =
	// existing
	| DeployFailureEvent
	| DeploySuccessEvent
	// new
	| { backend: string; environment; identifier: string; kind: "stateWritten" }
	| {
			changedFields: ReadonlyArray<string>;
			environment;
			key;
			kind: "resourceOpSucceeded";
			opType: "update";
			resourceKind;
	  }
	| {
			created: number;
			durationMs: number;
			environment;
			failed: number;
			kind: "applySummary";
			noop: number;
			updated: number;
	  }
	| {
			environment;
			error: ApplyError;
			key;
			kind: "resourceOpFailed";
			opType: "create" | "update";
			resourceKind;
	  }
	| { environment; key; kind: "resourceOpNoop"; resourceKind }
	| { environment; key; kind: "resourceOpStarted"; opType: "create" | "update"; resourceKind }
	| {
			environment;
			key;
			kind: "resourceOpSucceeded";
			opType: "create";
			outputs: ResourceOutputs;
			resourceKind;
	  };
// stateWritten.identifier is the backend-scoped pointer to the persisted
// snapshot. For the Gist backend it is the gist ID. Typed as `string`
// because every current backend identifies its target with a single
// opaque token; broaden if a future backend needs structured fields.
// changedFields on resourceOpSucceeded (update) is a list of top-level
// field names (e.g. ["price", "name"]) matching the granularity of
// module.fieldsEqual in core/diff.ts. Dotted sub-paths
// (e.g. "discordSocialLink.uri") are a separate decision if ever needed.
```

### Ordering contract revision

[core/diff.ts](../../packages/bedrock/src/core/diff.ts) currently codifies:
*"Ops appear in the order their desired entries appear in the input array so
callers can rely on declaration order when logging or applying ops."*

Revised: the **operations array** and the **persisted `applied[]` result**
remain in declaration order. The **execution order** and therefore the
**event emission order** are not guaranteed; events arrive as ops complete.

### Plan command alignment

`bedrock diff` (the plan command) is updated in the same PR to render the new
`changedFields` from `UpdateOperation`, so plan and apply share the same
source of truth for "what changed". This is a strict additive win — both
surfaces previously had to recompute or omit the detail.

### Out of scope

- `Apply? [y/N]` interactive confirm flow shown in the mockup. Separate
  workstream (TTY detection, `--yes` flag).
- Configurable parallelism cap. Defer until measurements justify the knob.
- Mantle parity check. We are deciding on merits; Mantle's choice does not bind.

## Consequences

### Positive

- A single deterministic failure (e.g. `updateUnsupported`) no longer blocks
  every unrelated op in the same deploy. The next deploy has less to
  reconcile.
- Real-time per-resource feedback. Users see what is created, updated, noop'd,
  and failed as it happens, not only an aggregate at the end.
- Faster wall-clock apply on large projects. ocale rate-limiting absorbs the
  concurrency safely; we are no longer artificially serialising independent
  HTTP calls.
- `bedrock diff` and `bedrock deploy` render `changedFields` from the same
  source. No drift between plan and apply UX.
- `ProgressPort` event surface grows along the additive seam its JSDoc
  already advertised. No port redesign.

### Negative

- Event order is non-deterministic. Tests asserting specific event sequences
  must relax to "set of events, any order". The clack output's clean
  top-to-bottom layout shown in mockups becomes completion-order interleave
  (matches `terraform apply -parallelism=N` UX).
- `ApplyError` and `DeployError.applyFailed` shape changes are breaking for
  any external consumer. Acceptable pre-1.0; would not be acceptable post-1.0
  without a deprecation cycle.
- Parallel apply makes the worst-case error volume larger. Where first-fail
  surfaced one error, continue-on-failure can surface N. Renderers must
  handle multi-error reporting cleanly.
- Memory cost per apply scales with `ops.length`: all `Promise` objects exist
  concurrently. Not a practical concern at current project sizes; revisit if
  apply runs above the low thousands of resources.
- The existing `@throws` contract on `applyOps`
  ([apply-ops.ts:96](../../packages/bedrock/src/shell/apply-ops.ts:96))
  changes meaning under parallel + `allSettled`. Today a thrown driver
  propagates the rejection and halts the batch; under the new design that
  throw is captured as a settled rejection scoped to the throwing op alone,
  surfaced as a `driverFailure` `ApplyError` so the rest of the batch is
  unaffected. The JSDoc must be updated accordingly: drivers no longer have
  a path to halt the batch via uncaught throws.

## Alternatives Considered

### Keep first-fail, improve only the UX

**Rejected because:** the user's concrete pain (`updateUnsupported` blocking
49 unrelated ops) is not a UX problem. Better error rendering would not have
caused the other ops to run. The algorithm itself is the issue.

### Continue-on-failure, sequential

**Rejected because:** ops are independent and ocale already manages rate
limiting and retry ([ADR-010](./010-sdk-managed-rate-limiting-and-retry.md)).
Sequential apply is leaving wall-clock time on the floor for no robustness
benefit. The diff.ts ordering contract had to be revised either way once
continue-on-failure landed (event interleave is a continue-on-failure
property as much as a parallelism one, once ops can fail mid-batch and
others keep running).

### Drop the `Result` wrapper on `applyOps`

**Rejected because:** `Result<Applied[], AggregateApplyError>` keeps callers
that already pattern-match on `result.success` working unchanged.
Conformance with [ADR-009](./009-result-types-over-exceptions.md) is
preserved. The aggregate-inside-Err shape is honest: any op failure is a
deploy failure for exit-code purposes, even though partial progress is
still persisted.

### Per-op outcome list as the return type

**Rejected because:** redundant once per-op events stream live. The batch
return only needs to feed (a) the state writer, (b) the exit-code decision,
and (c) programmatic consumers — none of which need per-op fidelity that
isn't already in the event stream.

### Compute `changedFields` in the apply loop instead of `diff()`

**Rejected because:** `diff()` already compares every field to decide
create-vs-update-vs-noop; recomputing in apply is duplicated work and a
second source of truth that can drift. Augmenting `UpdateOperation` keeps
the diff function as the single source.

## Implementation Notes

- `diff()` must populate `changedFields` for every `update` op; existing
  kind-module field-comparison logic in [core/kinds/](../../packages/bedrock/src/core/kinds/)
  already iterates fields and can emit the list as a byproduct. Field
  granularity matches `module.fieldsEqual` — top-level field names, not
  dotted sub-paths.
- `applyOps` accepts `progress: ProgressPort` and `environment: string` so
  events can be scoped per environment without callers post-processing.
- `dispatchOp` becomes responsible for emitting `resourceOpStarted` and the
  terminal event around the driver call. Driver throws that escape the
  driver's `Result` contract are caught at the `dispatchOp` boundary and
  translated to a `driverFailure` `ApplyError`, then emitted as
  `resourceOpFailed`.
- `applied[]` ordering: `Promise.allSettled` resolves to an array in the same
  order as its input promises, so the apply loop zips successful results
  back into `applied[]` by index — not by settle order. Renamed
  `appliedSoFar` should not return; the new field is unambiguously
  `applied`.
- `deploy.runReconcile` emits `applySummary` from the aggregate counts
  regardless of failures, then emits `stateWritten` only when
  `statePort.write` returns `Ok`.
- Existing `apply-ops.spec.ts` first-fail assertions must be inverted; new
  tests cover (a) all ops attempted past a failure, (b) `applied[]` order
  preserved under parallel completion (assert on result-array order, not
  call order), (c) `failures[]` carries every failure, (d) a driver that
  throws becomes a `driverFailure` without halting other ops.

## Related Decisions

- [ADR-009](./009-result-types-over-exceptions.md): `Result` wrapper preserved.
- [ADR-010](./010-sdk-managed-rate-limiting-and-retry.md): rate limiting and
  retry are owned by ocale; apply does not retry.
- [ADR-018](./018-fcis-ports-with-primary-driven-distinction.md):
  `ProgressPort` is a driven port consumed by the shell.
- [ADR-019](./019-state-data-model-and-diff-algebra.md): diff algebra and
  state data model; `UpdateOperation.changedFields` extends the contract
  described there.
