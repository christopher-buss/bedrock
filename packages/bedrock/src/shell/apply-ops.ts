/* eslint-disable max-lines -- exhaustive per-ResourceKind dispatch (applyOne, dispatchByKind, createSucceededEvent) plus progress emission helpers keep the apply pipeline cohesive in one module; splitting would scatter related code without improving navigation. */
import { ApiError, type OpenCloudError, type Result } from "@bedrock-rbx/ocale";

import { currentResourceIdentity } from "../core/current-resource-identity.ts";
import type { Operation } from "../core/operations.ts";
import type {
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
} from "../core/resources.ts";
import type { ProgressEvent, ProgressPort } from "../ports/progress-port.ts";
import type {
	DriverRegistry,
	ResourceApplyContext,
	ResourceDriver,
} from "../ports/resource-driver.ts";
import type { ResourceKey } from "../types/ids.ts";
import { applyWithVisibilityAsync, type VisibilityOutcome } from "./apply-visibility.ts";

/**
 * Optional wiring `applyOps` uses to emit per-resource and aggregate progress
 * events. When omitted, `applyOps` runs silently (backward-compatible with
 * pre-progress callers).
 *
 * @since 0.1.0
 */
export interface ApplyOpsReporting {
	/** Environment name stamped on every emitted event. */
	readonly environment: string;
	/** Sink the apply pipeline pushes events into. */
	readonly progress: ProgressPort;
}

/**
 * Failure surfaced by `applyOps` when an operation cannot be applied.
 * Plain-data discriminated union; narrow on `kind`, do not `instanceof` it.
 * One `ApplyError` describes one failing op; the surrounding
 * `AggregateApplyError` carries the full batch outcome (every survivor and
 * every failure).
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type ApplyError } from "@bedrock-rbx/core";
 *
 * function describe(err: ApplyError): string {
 *     switch (err.kind) {
 *         case "driverFailure": {
 *             return `driver failed for ${err.key}: ${err.cause.message}`;
 *         }
 *         case "unexpectedThrow": {
 *             return `unexpected error for ${err.key}`;
 *         }
 *         case "updateUnsupported": {
 *             return `update not supported for ${err.key}`;
 *         }
 *     }
 * }
 *
 * const err: ApplyError = {
 *     key: asResourceKey("vip-pass"),
 *     kind: "updateUnsupported",
 * };
 *
 * expect(describe(err)).toBe("update not supported for vip-pass");
 * ```
 */
export type ApplyError =
	| {
			readonly cause: OpenCloudError;
			readonly key: ResourceKey;
			readonly kind: "driverFailure";
	  }
	| {
			readonly cause: unknown;
			readonly key: ResourceKey;
			readonly kind: "unexpectedThrow";
	  }
	| {
			readonly key: ResourceKey;
			readonly kind: "updateUnsupported";
	  };

/**
 * Aggregate outcome returned by `applyOps` when one or more ops fail.
 * `applied` is the survivor set in Phase 1 then Phase 2 input order.
 * `failures` is the non-empty list of `ApplyError`s, one per failing op,
 * grouped the same way.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type AggregateApplyError } from "@bedrock-rbx/core";
 *
 * function summarize(err: AggregateApplyError): string {
 *     return `${err.applied.length} survived, ${err.failures.length} failed`;
 * }
 *
 * const err: AggregateApplyError = {
 *     applied: [],
 *     failures: [{ key: asResourceKey("vip-pass"), kind: "updateUnsupported" }],
 * };
 *
 * expect(summarize(err)).toBe("0 survived, 1 failed");
 * ```
 */
export interface AggregateApplyError {
	/** Survivors persisted to state, in Phase 1 then Phase 2 input order. */
	readonly applied: ReadonlyArray<ResourceCurrentState>;
	/** Per-op failures, at least one, in Phase 1 then Phase 2 input order. */
	readonly failures: readonly [ApplyError, ...ReadonlyArray<ApplyError>];
	/**
	 * Confirmed, unresolved, or deferred transitions for caller-owned
	 * recovery.
	 */
	readonly visibility?: ReadonlyArray<VisibilityOutcome>;
}

type NonNoopOp = Exclude<Operation, { readonly type: "noop" | "untrack" }>;

interface OutcomePair {
	readonly op: NonNoopOp;
	readonly outcome: Result<ResourceCurrentState, ApplyError>;
}

interface DispatchInPhasesInput {
	readonly artifacts: ReadonlyMap<ResourceKey, Uint8Array> | undefined;
	readonly phase1: ReadonlyArray<NonNoopOp>;
	readonly phase2: ReadonlyArray<NonNoopOp>;
	readonly registry: DriverRegistry;
	readonly reporting: ApplyOpsReporting | undefined;
}

interface ApplySummaryInput {
	readonly end: number;
	readonly failures: ReadonlyArray<ApplyError>;
	readonly noopCount: number;
	readonly pairs: ReadonlyArray<OutcomePair>;
	readonly reporting: ApplyOpsReporting | undefined;
	readonly start: number;
	readonly untrackCount: number;
}

interface CreateSucceededInput {
	readonly key: ResourceKey;
	readonly environment: string;
	readonly state: ResourceCurrentState;
}

interface TerminalEventInput {
	readonly environment: string;
	readonly op: NonNoopOp;
	readonly outcome: Result<ResourceCurrentState, ApplyError>;
}

interface ReportAndDispatchInput {
	readonly artifacts: ReadonlyMap<ResourceKey, Uint8Array> | undefined;
	readonly op: NonNoopOp;
	readonly registry: DriverRegistry;
	readonly reporting: ApplyOpsReporting | undefined;
}

interface DispatchDependencies {
	readonly context: ResourceApplyContext | undefined;
	readonly registry: DriverRegistry;
}

/**
 * Dispatch reconciliation operations with private visibility first and public
 * visibility last. A required private transition must succeed before any
 * ordinary resource work runs; an unconfirmed private result stops the batch.
 * Public transitions run only after all ordinary operations succeed.
 *
 * Ordinary work runs in two phases: universe operations run sequentially to
 * avoid the root-place `displayName` race, then other non-noop operations run
 * concurrently. An ordinary resource failure does not stop unrelated work.
 * Confirmed ordinary noops perform no upstream writes.
 *
 * Ordering covers only the supplied batch. A caller owns sequencing against
 * external builds or other batches, transition-intent checkpoints, and State
 * persistence; this function performs no hidden State reads or writes.
 *
 * Behaviour:
 * - `create` operations route to `registry[op.desired.kind].create`.
 * - `update` operations route to `registry[op.desired.kind].update` when the
 *   driver exposes it; otherwise they yield an `updateUnsupported`
 *   `ApplyError` without invoking the driver.
 * - `retire` dispatches the stored current state to the required driver method.
 *   Successful retirements return that identity so snapshot callers can drop
 *   it.
 * - `noop` operations are skipped entirely (no I/O, no dispatch).
 * - A driver that throws outside its `Result` contract is caught at the
 *   dispatch boundary and translated to an `unexpectedThrow` `ApplyError`
 *   scoped to that op alone; ordinary work continues unless a private gate
 *   failed.
 *
 * On Ok the returned array carries driver outputs for every non-noop op
 * in phase order: Phase 1 universe entries first, then Phase 2 entries in
 * their input order. Noops are not represented; callers needing a full
 * post-apply snapshot merge with the pre-apply current state keyed by
 * `ResourceKey`.
 *
 * On Err the aggregate carries ordinary survivors in phase order, any retained
 * confirmed universe snapshot, and the failing operations. Optional visibility
 * outcomes distinguish confirmed, deferred, and unresolved transitions so a
 * persistence-owning caller can recover without recording unconfirmed
 * visibility as Current state.
 *
 * @since 0.1.0
 *
 * @param ops - Reconciliation operations produced by `diff`, applied in
 *   declaration order.
 * @param registry - Per-kind driver table; dispatch uses `op.desired.kind`
 *   as the index.
 * @param reporting - Optional progress wiring. When supplied, `applyOps`
 *   emits start and terminal events for attempted ordinary work and required
 *   visibility transitions. The ordinary phase reports its noops, and one
 *   final `applySummary` counts supplied operations without double-counting a
 *   split universe operation. Duration includes visibility gates. When
 *   omitted, no events fire.
 * @param artifacts - Optional per-key artifact bytes. When supplied, each
 *   dispatched op's driver receives a `ResourceApplyContext` carrying the
 *   matching key's bytes in place of its on-disk file; when omitted, drivers
 *   are called without a context argument.
 * @returns `Ok(state)` when every op succeeded; otherwise
 *   `Err(AggregateApplyError)` with the survivors and the non-empty
 *   failures tuple.
 * @example
 *
 * ```ts
 * import { applyOps, OpenCloudError, type DriverRegistry } from "@bedrock-rbx/core";
 *
 * const noopRegistry: DriverRegistry = {
 *     developerProduct: { retire: async () => ({ err: new OpenCloudError("Retirement is not implemented in this example"), success: false }), create: async () => ({ err: new Error("stub") as never, success: false }) },
 *     gamePass: { retire: async () => ({ err: new OpenCloudError("Retirement is not implemented in this example"), success: false }), create: async () => ({ err: new Error("stub") as never, success: false }) },
 *     place: { retire: async () => ({ err: new OpenCloudError("Retirement is not implemented in this example"), success: false }), create: async () => ({ err: new Error("stub") as never, success: false }) },
 *     universe: { retire: async () => ({ err: new OpenCloudError("Retirement is not implemented in this example"), success: false }), create: async () => ({ err: new Error("stub") as never, success: false }) },
 * };
 *
 * return applyOps([], noopRegistry).then((result) => {
 *     expect(result).toStrictEqual({ data: [], success: true });
 * });
 * ```
 */
// eslint-disable-next-line better-max-params/better-max-params -- additive optional progress hook on the established two-positional-deps shape; folding into an options bag would break every caller for no semantic gain.
export async function applyOps(
	ops: ReadonlyArray<Operation>,
	registry: DriverRegistry,
	reporting?: ApplyOpsReporting,
	artifacts?: ReadonlyMap<ResourceKey, Uint8Array>,
): Promise<Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>> {
	return applyWithVisibilityAsync({
		ops,
		ordinary: async (ordinary, ordinaryReporting) => {
			return applyOrdinaryOpsAsync({
				artifacts,
				ops: ordinary,
				registry,
				reporting: ordinaryReporting,
			});
		},
		registry,
		reporting,
	});
}

function driverFailure(
	key: ResourceKey,
	cause: OpenCloudError,
): Result<ResourceCurrentState, ApplyError> {
	return { err: { key, cause, kind: "driverFailure" }, success: false };
}

function kindMismatch(key: ResourceKey, mismatch: { actual: string; expected: string }): ApiError {
	return new ApiError(
		`internal: operation kind mismatch for ${key}: expected ${mismatch.expected}, got ${mismatch.actual}`,
		{ statusCode: 0 },
	);
}

function isCurrentOfKind<K extends ResourceKind>(
	current: ResourceCurrentState,
	kind: K,
): current is ResourceCurrentState<K> {
	return current.kind === kind;
}

async function applyOneAsync<K extends ResourceKind>(
	op: Exclude<NonNoopOp, { type: "retire" }> & {
		readonly desired: Extract<ResourceDesiredState, { kind: K }>;
	},
	{
		context,
		driver,
	}: {
		readonly context: ResourceApplyContext | undefined;
		readonly driver: ResourceDriver<K>;
	},
): Promise<Result<ResourceCurrentState, ApplyError>> {
	if (op.type === "create") {
		const created =
			context === undefined
				? await driver.create(op.desired)
				: await driver.create(op.desired, context);
		return created.success ? created : driverFailure(op.key, created.err);
	}

	if (driver.update === undefined) {
		return { err: { key: op.key, kind: "updateUnsupported" }, success: false };
	}

	const { current } = op;
	if (!isCurrentOfKind(current, op.desired.kind)) {
		return driverFailure(
			op.key,
			kindMismatch(op.key, { actual: current.kind, expected: op.desired.kind }),
		);
	}

	const updated = await (context === undefined
		? driver.update(current, op.desired)
		: driver.update(current, op.desired, context));
	return updated.success ? updated : driverFailure(op.key, updated.err);
}

async function dispatchRetireAsync(
	current: ResourceCurrentState<Exclude<ResourceKind, "universe">>,
	registry: DriverRegistry,
): Promise<Result<undefined, OpenCloudError>> {
	switch (current.kind) {
		case "developerProduct": {
			return registry.developerProduct.retire(current);
		}
		case "gamePass": {
			return registry.gamePass.retire(current);
		}
		case "place": {
			return registry.place.retire(current);
		}
	}
}

async function dispatchByKindAsync(
	op: NonNoopOp,
	{ context, registry }: DispatchDependencies,
): Promise<Result<ResourceCurrentState, ApplyError>> {
	// Exhaustive switch: adding a new ResourceKind is a compile error here
	// until an arm lands. Narrowing `desired` on its own discriminator does
	// not propagate to the operation that carries it, so each arm rebuilds
	// the operation around the narrowed value.
	if (op.type === "retire") {
		const { current } = op;
		const retired = await dispatchRetireAsync(current, registry);
		return retired.success
			? { data: current, success: true }
			: driverFailure(op.key, retired.err);
	}

	const { desired } = op;
	switch (desired.kind) {
		case "developerProduct": {
			return applyOneAsync(
				{ ...op, desired },
				{ context, driver: registry.developerProduct },
			);
		}
		case "gamePass": {
			return applyOneAsync({ ...op, desired }, { context, driver: registry.gamePass });
		}
		case "place": {
			return applyOneAsync({ ...op, desired }, { context, driver: registry.place });
		}
		case "universe": {
			return applyOneAsync({ ...op, desired }, { context, driver: registry.universe });
		}
	}
}

async function dispatchOpAsync(
	op: NonNoopOp,
	dependencies: DispatchDependencies,
): Promise<Result<ResourceCurrentState, ApplyError>> {
	try {
		return await dispatchByKindAsync(op, dependencies);
	} catch (err) {
		return { err: { key: op.key, cause: err, kind: "unexpectedThrow" }, success: false };
	}
}

function createSucceededEvent({ key, environment, state }: CreateSucceededInput): ProgressEvent {
	// The four arms differ only in their `resourceKind` literal, but the event
	// union correlates that literal with the matching `outputs` shape, so a
	// single `resourceKind: state.kind` return does not type-check.
	const base = { key, environment, kind: "resourceOpSucceeded", opType: "create" } as const;
	switch (state.kind) {
		case "developerProduct": {
			return { ...base, outputs: state.outputs, resourceKind: "developerProduct" };
		}
		case "gamePass": {
			return { ...base, outputs: state.outputs, resourceKind: "gamePass" };
		}
		case "place": {
			return { ...base, outputs: state.outputs, resourceKind: "place" };
		}
		case "universe": {
			return { ...base, outputs: state.outputs, resourceKind: "universe" };
		}
	}
}

function toSucceededEvent({
	environment,
	op,
	state,
}: {
	readonly environment: string;
	readonly op: NonNoopOp;
	readonly state: ResourceCurrentState;
}): ProgressEvent {
	const resource = { key: op.key, environment };

	if (op.type === "retire") {
		return {
			...resource,
			kind: "resourceOpSucceeded",
			opType: "retire",
			resourceKind: op.current.kind,
			...currentResourceIdentity(op.current),
		};
	}

	if (op.type === "update") {
		return {
			...resource,
			changedFields: op.changedFields,
			kind: "resourceOpSucceeded",
			opType: "update",
			resourceKind: op.desired.kind,
		};
	}

	return createSucceededEvent({ key: op.key, environment, state });
}

function toTerminalEvent({ environment, op, outcome }: TerminalEventInput): ProgressEvent {
	const resource = { key: op.key, environment };
	if (!outcome.success) {
		return {
			...resource,
			error: outcome.err,
			kind: "resourceOpFailed",
			opType: op.type,
			resourceKind: op.type === "retire" ? op.current.kind : op.desired.kind,
			...(op.type === "retire" ? currentResourceIdentity(op.current) : {}),
		};
	}

	return toSucceededEvent({ environment, op, state: outcome.data });
}

async function reportAndDispatchAsync({
	artifacts,
	op,
	registry,
	reporting,
}: ReportAndDispatchInput): Promise<OutcomePair> {
	if (reporting !== undefined) {
		reporting.progress.emit({
			key: op.key,
			environment: reporting.environment,
			kind: "resourceOpStarted",
			opType: op.type,
			resourceKind: op.type === "retire" ? op.current.kind : op.desired.kind,
			...(op.type === "retire" ? currentResourceIdentity(op.current) : {}),
		});
	}

	const artifact = artifacts?.get(op.key);
	const context = artifact === undefined ? undefined : { artifact };
	const outcome = await dispatchOpAsync(op, { context, registry });
	if (reporting !== undefined) {
		reporting.progress.emit(
			toTerminalEvent({ environment: reporting.environment, op, outcome }),
		);
	}

	return { op, outcome };
}

async function dispatchInPhasesAsync({
	artifacts,
	phase1,
	phase2,
	registry,
	reporting,
}: DispatchInPhasesInput): Promise<ReadonlyArray<OutcomePair>> {
	const phase1Pairs: Array<OutcomePair> = [];
	for (const op of phase1) {
		phase1Pairs.push(await reportAndDispatchAsync({ artifacts, op, registry, reporting }));
	}

	const phase2Pairs = await Promise.all(
		phase2.map(async (op) => reportAndDispatchAsync({ artifacts, op, registry, reporting })),
	);
	return [...phase1Pairs, ...phase2Pairs];
}

function emitApplySummary(input: ApplySummaryInput): void {
	if (input.reporting === undefined) {
		return;
	}

	const created = input.pairs.filter(
		(pair) => pair.outcome.success && pair.op.type === "create",
	).length;
	const updated = input.pairs.filter(
		(pair) => pair.outcome.success && pair.op.type === "update",
	).length;
	input.reporting.progress.emit({
		created,
		durationMs: input.end - input.start,
		environment: input.reporting.environment,
		failed: input.failures.length,
		kind: "applySummary",
		noop: input.noopCount,
		retired: input.pairs.filter((pair) => pair.outcome.success && pair.op.type === "retire")
			.length,
		untracked: input.untrackCount,
		updated,
	});
}

function partitionOutcomes(outcomes: ReadonlyArray<Result<ResourceCurrentState, ApplyError>>): {
	readonly applied: ReadonlyArray<ResourceCurrentState>;
	readonly failures: ReadonlyArray<ApplyError>;
} {
	const applied = outcomes.flatMap((outcome) => (outcome.success ? [outcome.data] : []));
	const failures = outcomes.flatMap((outcome) => (outcome.success ? [] : [outcome.err]));
	return { applied, failures };
}

function emitNoop(
	op: Extract<Operation, { readonly type: "noop" }>,
	reporting: ApplyOpsReporting | undefined,
): void {
	if (reporting === undefined) {
		return;
	}

	reporting.progress.emit({
		key: op.key,
		environment: reporting.environment,
		kind: "resourceOpNoop",
		resourceKind: op.kind,
	});
}

function emitUntrack(
	op: Extract<Operation, { readonly type: "untrack" }>,
	reporting: ApplyOpsReporting | undefined,
): void {
	if (reporting === undefined) {
		return;
	}

	const resource = {
		key: op.key,
		environment: reporting.environment,
		opType: "untrack",
		resourceKind: op.current.kind,
	} as const;
	reporting.progress.emit({ ...resource, kind: "resourceOpStarted" });
	reporting.progress.emit({
		...resource,
		...currentResourceIdentity(op.current),
		kind: "resourceOpSucceeded",
	});
}

function partitionAndEmitNoops(
	ops: ReadonlyArray<Operation>,
	reporting: ApplyOpsReporting | undefined,
): {
	readonly noopCount: number;
	readonly phase1: ReadonlyArray<NonNoopOp>;
	readonly phase2: ReadonlyArray<NonNoopOp>;
	readonly untrackCount: number;
} {
	const phase1: Array<NonNoopOp> = [];
	const phase2: Array<NonNoopOp> = [];
	let noopCount = 0;
	let untrackCount = 0;
	for (const op of ops) {
		if (op.type === "noop") {
			noopCount += 1;
			emitNoop(op, reporting);
		} else if (op.type === "untrack") {
			untrackCount += 1;
			emitUntrack(op, reporting);
		} else if (op.type !== "retire" && op.desired.kind === "universe") {
			phase1.push(op);
		} else {
			phase2.push(op);
		}
	}

	return { noopCount, phase1, phase2, untrackCount };
}

async function applyOrdinaryOpsAsync({
	artifacts,
	ops,
	registry,
	reporting,
}: {
	readonly artifacts: ReadonlyMap<ResourceKey, Uint8Array> | undefined;
	readonly ops: ReadonlyArray<Operation>;
	readonly registry: DriverRegistry;
	readonly reporting: ApplyOpsReporting | undefined;
}): Promise<Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>> {
	const start = Date.now();
	const { noopCount, phase1, phase2, untrackCount } = partitionAndEmitNoops(ops, reporting);
	const pairs = await dispatchInPhasesAsync({ artifacts, phase1, phase2, registry, reporting });
	const end = Date.now();

	const { applied, failures } = partitionOutcomes(pairs.map((pair) => pair.outcome));
	emitApplySummary({ end, failures, noopCount, pairs, reporting, start, untrackCount });

	const [head, ...tail] = failures;
	if (head === undefined) {
		return { data: applied, success: true };
	}

	return { err: { applied, failures: [head, ...tail] }, success: false };
}
