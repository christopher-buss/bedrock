# ADR-023: Apply Semantics — Parallel, Continue-on-Failure, Per-Op Progress Events

**Date:** 2026-05-14 **Status:** Accepted

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

1. **Deterministic failures punish unrelated resources.** Any deterministic
   apply failure (e.g. `updateUnsupported` from a custom or future driver, or
   a 4xx validation error from Open Cloud) skips every other pending op even
   though the queued resources would have been unaffected. A single failure
   blocks dozens of unrelated reconciliations and forces another deploy to
   converge them.
2. **No per-resource progress visibility.** The `ProgressPort`
   ([packages/bedrock/src/ports/progress-port.ts](../../packages/bedrock/src/ports/progress-port.ts))
   currently emits a single `deploySuccess` or `deployFailure` event per
   environment. The port JSDoc explicitly anticipates per-resource event
   variants, but they do not yet exist. Users cannot tell mid-deploy what
   has reconciled and what has not.

### Independence at apply time

A premise of any parallel apply design is that ops do not interfere. The
current resource kinds satisfy this in **output-flow** terms — no op
consumes another op's outputs within the same apply:

- `GamePass` and `DeveloperProduct` drivers bind `universeId` at driver
  construction
  ([game-pass-driver.ts:46](../../packages/bedrock/src/adapters/game-pass-driver.ts:46),
  [developer-product-driver.ts:53](../../packages/bedrock/src/adapters/developer-product-driver.ts:53)),
  so they never reach into another op's result.
- `Universe` is adopted, not minted: the user supplies an existing
  `universeId` on the desired state ([resources.ts:238](../../packages/bedrock/src/core/resources.ts:238)).
  No op produces a universeId for another to consume.
- `Place.versionNumber` is the only Roblox-returned identifier and is not
  read back by any other op in the same apply.

Output-flow independence holds. But there is one **shared-endpoint
collision**: the `Universe` driver routes `displayName` updates through
`PlacesClient.update` ([resources.ts:208-213](../../packages/bedrock/src/core/resources.ts:208))
because the universe PATCH endpoint treats `displayName` as read-only. If a
configured `Place` is the root place of the same universe, two concurrent
PATCHes can hit the same upstream resource. This invalidates "fully
parallel" but admits an easy two-phase remedy (see Decision).

Retry and rate limiting are absorbed inside `@bedrock-rbx/ocale` per
[ADR-010](./010-sdk-managed-rate-limiting-and-retry.md); a failure surfaced
to apply has already exhausted retries.

## Decision

`applyOps` becomes **two-phase, continue-on-failure**, and instrumented with
per-op `ProgressPort` events:

1. **Phase 1** — `Universe` op(s) run sequentially. `Universe` is a singleton
   per environment, so at most one op runs here. Sequencing it before
   everything else removes the documented `displayName` race against
   `Place(root)`.
2. **Phase 2** — every remaining non-noop op dispatches concurrently via
   `Promise.allSettled`. `allSettled` (not `all`) is deliberate: a driver
   that throws outside its `Result` contract settles as a rejection for that
   op alone, without short-circuiting the in-flight batch. **Phase 2 runs
   regardless of Phase 1's outcome** — a failed universe op does not block
   the rest, consistent with continue-on-failure.

Per-op event emission:

- Each dispatch emits `resourceOpStarted` before the driver call and
  `resourceOpSucceeded` or `resourceOpFailed` after it returns.
- `noop` ops emit a single `resourceOpNoop` event (no dispatch, no driver
  call).

Return shape:

- After both phases settle, `applyOps` returns
  `Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>`:
  - **Ok** when no op failed; `applied[]` is in declaration order (Phase 1
    universe ops first, then Phase 2 ops in input order;
    `Promise.allSettled` preserves input order in its results array, so we
    zip by index, not by completion time).
  - **Err** when one or more ops failed; the aggregate carries both the
    `applied` set and the `failures` list.

State persistence:

- `deploy.runReconcile` writes the merged state regardless of whether any
  op failed (preserving today's "persist what succeeded" behaviour). It
  then emits `applySummary` unconditionally. `stateWritten` is emitted only
  when `statePort.write` returns `Ok`; on write failure, the existing
  `stateWriteFailed` error path runs and no `stateWritten` event fires.

### State-write failure: orphan recovery contract

Under continue-on-failure with parallel Phase 2, a `statePort.write` failure
can occur after multiple resources have been created/updated remotely. The
old first-fail model bounded this to at most one resource ahead of the
failure; the new model can leave N. We accept this trade-off pre-1.0 with
two explicit mitigations:

1. **The `stateWriteFailed` error already carries `unsavedState`**
   ([deploy.ts:77-81](../../packages/bedrock/src/shell/deploy.ts:77)). The
   CLI renders the unsaved snapshot to stderr so an operator can manually
   reconcile the state file. This is a documented manual-recovery path,
   not an automatic one.
2. **Drivers should be tolerant of replay where Open Cloud supports it.**
   Most Open Cloud creates return a server-assigned identifier; the
   replay risk is duplicate creation, not silent corruption. Drivers that
   can detect existing resources (e.g. by name within universe) should
   prefer adopt-over-create when state has been lost. Drivers that
   cannot are limited by Open Cloud's API surface, not by bedrock.

A transaction-log artefact written before remote mutation would give a
stronger contract but adds significant complexity (a new port for the
journal, replay logic in deploy). It is a candidate future enhancement,
not part of this ADR.

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
	| { cause: unknown; key: ResourceKey; kind: "unexpectedThrow" } // NEW
	| { key: ResourceKey; kind: "updateUnsupported" };
//   appliedSoFar removed — moved up to AggregateApplyError.applied
//   unexpectedThrow captures non-OpenCloudError rejections from drivers
//   (e.g. fs errors from readFile, programming errors). cause is `unknown`
//   because the surface area of possible throws is open.

interface AggregateApplyError {
	readonly applied: ReadonlyArray<ResourceCurrentState>; // in declaration order
	readonly failures: ReadonlyArray<ApplyError>; // 1..N
}

// shell/deploy.ts
interface DeployOptions {
	/* existing fields unchanged */
	readonly progress?: ProgressPort; // NEW: injected by callers (CLI plumbs through)
}

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
	| {
			changedFields: ReadonlyArray<string>;
			environment: string;
			key: ResourceKey;
			kind: "resourceOpSucceeded";
			opType: "update";
			resourceKind: ResourceKind;
	  }
	| {
			created: number;
			durationMs: number;
			environment: string;
			failed: number;
			kind: "applySummary";
			noop: number;
			updated: number;
	  }
	| {
			environment: string;
			error: ApplyError;
			key: ResourceKey;
			kind: "resourceOpFailed";
			opType: "create" | "update";
			resourceKind: ResourceKind;
	  }
	| {
			environment: string;
			key: ResourceKey;
			kind: "resourceOpNoop";
			resourceKind: ResourceKind;
	  }
	| {
			environment: string;
			key: ResourceKey;
			kind: "resourceOpStarted";
			opType: "create" | "update";
			resourceKind: ResourceKind;
	  }
	| {
			environment: string;
			key: ResourceKey;
			kind: "resourceOpSucceeded";
			opType: "create";
			outputs: ResourceOutputs;
			resourceKind: ResourceKind;
	  }
	| { environment: string; kind: "stateWritten" };
// `resourceOpSucceeded` is split into two arms by opType (`create` carries
// `outputs`; `update` carries `changedFields`). Adapters that switch on
// `kind` alone must further narrow on `opType` to access the
// variant-specific payload.
// `changedFields` is a list of top-level field names (e.g. ["price",
// "name"]) matching the granularity of `module.fieldsEqual` in
// core/diff.ts. Dotted sub-paths (e.g. "discordSocialLink.uri") are a
// separate decision if ever needed.
// `stateWritten` carries no backend identity. `StatePort` is opaque to
// `runReconcile`; the CLI renders backend/identifier strings from the
// project config it already loaded, not from the event payload.
// `applySummary.durationMs` is measured inside `applyOps` from function
// entry to the resolution of Phase 2's `Promise.allSettled`. State-write
// time is excluded.
```

### Ordering contract revision

[core/diff.ts](../../packages/bedrock/src/core/diff.ts) currently codifies:
*"Ops appear in the order their desired entries appear in the input array so
callers can rely on declaration order when logging or applying ops."*

Revised: the **operations array** and the **persisted `applied[]` result**
remain in declaration order, with `Universe` ops grouped first by virtue of
the two-phase algorithm. The **execution order within Phase 2** and
therefore the **event emission order** are not guaranteed; events arrive as
ops complete.

### Plan command alignment

Once `UpdateOperation` carries `changedFields`, `bedrock diff` (the plan
command) will be updated in the implementation PR to render that field, so
plan and apply share the same source of truth for "what changed". This is a
strict additive win — both surfaces previously had to recompute or omit the
detail.

### Out of scope

- `Apply? [y/N]` interactive confirm flow shown in the mockup. Separate
  workstream (TTY detection, `--yes` flag).
- Configurable parallelism cap. Defer until measurements justify the knob.
- Transaction-log artefact for state-write recovery. Listed as a future
  enhancement above; not part of this ADR.
- Mantle parity check. We are deciding on merits; Mantle's choice does not
  bind.

## Consequences

### Positive

- A single deterministic failure no longer blocks every unrelated op in the
  same deploy. The next deploy has less to reconcile.
- Real-time per-resource feedback. Users see what is created, updated,
  noop'd, and failed as it happens, not only an aggregate at the end.
- Faster wall-clock apply on large projects. Phase 2 parallelism is the
  primary win; ocale rate-limiting absorbs concurrency safely.
- `bedrock diff` and `bedrock deploy` will render `changedFields` from the
  same source. No drift between plan and apply UX.
- `ProgressPort` event surface grows along the additive seam its JSDoc
  already advertised. No port redesign.

### Negative

- Event order is non-deterministic within Phase 2. Tests asserting specific
  event sequences must relax to "set of events, any order". The clack
  output's clean top-to-bottom layout shown in mockups becomes
  completion-order interleave (matches `terraform apply -parallelism=N`
  UX).
- `ApplyError`, `DeployError.applyFailed`, and `DeployOptions` shape
  changes are breaking for any external consumer. Acceptable pre-1.0;
  would not be acceptable post-1.0 without a deprecation cycle.
- Parallel Phase 2 makes the worst-case error volume larger. Where
  first-fail surfaced one error, continue-on-failure can surface N.
  Renderers must handle multi-error reporting cleanly.
- **State-write failure after parallel Phase 2 can leave up to N orphaned
  remote resources whose IDs are absent from the state file.** Manual
  reconciliation via the `unsavedState` field on `stateWriteFailed` is the
  documented recovery path. This is materially worse than first-fail, which
  bounded orphans to one. Accepted pre-1.0; a transaction-log adapter is
  the natural escape hatch later.
- Memory cost per apply scales with `ops.length`: all `Promise` objects exist
  concurrently. Not a practical concern at current project sizes; revisit if
  apply runs above the low thousands of resources.
- The existing `@throws` contract on `applyOps`
  ([apply-ops.ts:96](../../packages/bedrock/src/shell/apply-ops.ts:96))
  changes meaning under parallel + `allSettled`. Today a thrown driver
  propagates the rejection and halts the batch; under the new design that
  throw is captured as a settled rejection scoped to the throwing op alone,
  surfaced as an `unexpectedThrow` `ApplyError` so the rest of the batch is
  unaffected. The JSDoc must be updated accordingly: drivers no longer have
  a path to halt the batch via uncaught throws.

## Alternatives Considered

### Keep first-fail, improve only the UX

**Rejected because:** the original pain (a deterministic failure blocking
every queued op) is not a UX problem. Better error rendering would not have
caused the other ops to run. The algorithm itself is the issue.

### Continue-on-failure, fully sequential

**Rejected because:** for output-flow-independent ops there is no
robustness reason to serialise. ocale already manages rate limiting and
retry ([ADR-010](./010-sdk-managed-rate-limiting-and-retry.md)). Sequential
apply leaves wall-clock time on the floor. The diff.ts ordering contract
had to be revised either way once continue-on-failure landed (event
interleave is a continue-on-failure property as much as a parallelism one,
once ops can fail mid-batch and others keep running).

### Fully parallel (no two-phase split)

**Rejected because:** Universe.displayName routes through
`PlacesClient.update`. If a configured `Place` is the root place of the
same universe, two concurrent PATCHes can race the same upstream
`displayName`. Two-phase apply (Universe first, then everything in
parallel) removes the race while keeping nearly all of the parallelism
benefit, since Universe is a singleton.

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

### Add a transaction log before every remote mutation (for orphan recovery)

**Rejected because:** doubles the I/O cost per op, requires a new port and
adapter, and adds replay logic to `deploy`. The manual-recovery path via
`unsavedState` is sufficient for pre-1.0. Revisit post-publish if state
backend failures become observable in practice.

## Implementation Notes

- `diff()` must populate `changedFields` for every `update` op; existing
  kind-module field-comparison logic in [core/kinds/](../../packages/bedrock/src/core/kinds/)
  already iterates fields and can emit the list as a byproduct. Field
  granularity matches `module.fieldsEqual` — top-level field names, not
  dotted sub-paths.
- `applyOps` accepts `progress: ProgressPort` and `environment: string` so
  events can be scoped per environment without callers post-processing.
  Callers thread the port through `DeployOptions.progress`.
- `applyOps` partitions ops by `desired.kind === "universe"` and runs the
  universe partition sequentially before dispatching the rest under
  `Promise.allSettled`. Phase 2 runs even if Phase 1 fails (continue-on-
  failure applies across phases).
- `dispatchOp` becomes responsible for emitting `resourceOpStarted` and the
  terminal event around the driver call. Driver throws that escape the
  driver's `Result` contract are caught at the `dispatchOp` boundary and
  translated to an `unexpectedThrow` `ApplyError`, then emitted as
  `resourceOpFailed`.
- `applied[]` ordering: `Promise.allSettled` resolves to an array in the same
  order as its input promises. The apply loop zips successful results back
  into `applied[]` by index, with Phase 1 entries first, then Phase 2
  entries in their input order. Renamed `appliedSoFar` does not return;
  the new field is unambiguously `applied`.
- `deploy.runReconcile` emits `applySummary` from the aggregate counts
  regardless of failures, then emits `stateWritten` only when
  `statePort.write` returns `Ok`. The summary's `durationMs` is sourced
  from `applyOps` (entry → both phases settled), not from `runReconcile`,
  so it reflects pure apply time.
- Internal `deploy.ts` types ripple: `SnapshotInputs.applied` and
  `FinalizeInputs.applied` change from `Result<…, ApplyError>` to
  `Result<…, AggregateApplyError>`; `buildSnapshot`'s read of
  `inputs.applied.err.appliedSoFar` becomes `inputs.applied.err.applied`.
- `ApplyError`'s own `@example` JSDoc
  ([apply-ops.ts:44-48](../../packages/bedrock/src/shell/apply-ops.ts:44))
  references `appliedSoFar: []` and must be rewritten alongside the type
  change. `pnpm gen:example-tests` will fail until it is.
- Existing `apply-ops.spec.ts` first-fail assertions must be inverted; new
  tests cover (a) all ops attempted past a failure, (b) `applied[]` order
  preserved under parallel completion (assert on result-array order, not
  call order), (c) `failures[]` carries every failure, (d) a driver that
  throws becomes an `unexpectedThrow` without halting other ops, (e)
  Phase 1 universe op completes before any Phase 2 op starts, (f) Phase 2
  still runs when Phase 1 fails.

## Related Decisions

- [ADR-009](./009-result-types-over-exceptions.md): `Result` wrapper preserved.
- [ADR-010](./010-sdk-managed-rate-limiting-and-retry.md): rate limiting and
  retry are owned by ocale; apply does not retry.
- [ADR-018](./018-fcis-ports-with-primary-driven-distinction.md):
  `ProgressPort` is a driven port consumed by the shell.
- [ADR-019](./019-state-data-model-and-diff-algebra.md): diff algebra and
  state data model; `UpdateOperation.changedFields` extends the contract
  described there.

## Amendments

### 2026-05-18: Non-empty `failures` tuple

`AggregateApplyError.failures` ships as `readonly [ApplyError,
...ReadonlyArray<ApplyError>]` rather than `ReadonlyArray<ApplyError>`.
The algorithm only returns `Err` when at least one op failed, so the
non-empty tuple encodes the runtime invariant in the type. The CLI
renderer reads `failures[0]` and iterates without defensive empty-array
branches, and consumers narrowing the aggregate can rely on `failures`
always carrying at least one entry.

### 2026-05-18: Phase 2 dispatches with `Promise.all`

**This amendment supersedes the `Promise.allSettled` decision recorded in
the original Decision section's Phase 2 description and in the
Implementation Notes section.**

Phase 2 dispatches concurrently via `Promise.all` rather than
`Promise.allSettled`. The dispatch-boundary try/catch inside `dispatchOp`
catches any rejection a driver produces outside its `Result` contract
and translates it into an `unexpectedThrow` `ApplyError`, so by the time
`Promise.all` awaits the phase-2 map, no individual dispatch can reject.
`Promise.allSettled`'s rejection-handling branch would be unreachable
under that contract; `Promise.all` keeps the apply path honest about
where rejections can come from. The original ADR text predated the
dispatch-boundary catch and assumed rejections could still escape.
