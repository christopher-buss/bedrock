import { ApiError, type OpenCloudError, type Result } from "@bedrock-rbx/ocale";

import type { Operation } from "../core/operations.ts";
import type {
	DeveloperProductDesiredState,
	GamePassDesiredState,
	PlaceDesiredState,
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
	UniverseDesiredState,
} from "../core/resources.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { ResourceKey } from "../types/ids.ts";

/**
 * Failure surfaced by `applyOps` when an operation cannot be applied.
 * Plain-data discriminated union; narrow on `kind`, do not `instanceof` it.
 * One `ApplyError` describes one failing op; the surrounding
 * `AggregateApplyError` carries the full batch outcome (every survivor and
 * every failure).
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
 * `applied` is the survivor set in declaration order. `failures` is the
 * non-empty list of `ApplyError`s, one per failing op.
 */
export interface AggregateApplyError {
	/** Survivors persisted to state, in declaration order. */
	readonly applied: ReadonlyArray<ResourceCurrentState>;
	/** Per-op failures, at least one. */
	readonly failures: readonly [ApplyError, ...ReadonlyArray<ApplyError>];
}

type NonNoopOp = Exclude<Operation, { readonly type: "noop" }>;
type DeveloperProductOp = NonNoopOp & { readonly desired: DeveloperProductDesiredState };
type GamePassOp = NonNoopOp & { readonly desired: GamePassDesiredState };
type PlaceOp = NonNoopOp & { readonly desired: PlaceDesiredState };
type UniverseOp = NonNoopOp & { readonly desired: UniverseDesiredState };

/**
 * Dispatch reconciliation operations to their matching drivers in two phases
 * with continue-on-failure semantics. Phase 1 runs universe ops sequentially
 * (singleton per environment; sequencing it before everything else avoids the
 * `displayName` race against the root `Place`). Phase 2 dispatches every
 * remaining non-noop op concurrently via `Promise.all`; every op is
 * attempted regardless of earlier failures.
 *
 * Behaviour:
 * - `create` operations route to `registry[op.desired.kind].create`.
 * - `update` operations route to `registry[op.desired.kind].update` when the
 *   driver exposes it; otherwise they yield an `updateUnsupported`
 *   `ApplyError` without invoking the driver.
 * - `noop` operations are skipped entirely (no I/O, no dispatch).
 * - A driver that throws outside its `Result` contract is caught at the
 *   dispatch boundary and translated to an `unexpectedThrow` `ApplyError`
 *   scoped to that op alone; the rest of the batch keeps running.
 *
 * On Ok the returned array carries driver outputs for every non-noop op
 * in phase order: Phase 1 universe entries first, then Phase 2 entries in
 * their input order. Noops are not represented; callers needing a full
 * post-apply snapshot merge with the pre-apply current state keyed by
 * `ResourceKey`.
 *
 * On Err the aggregate carries every survivor in `applied` (Phase 1 first,
 * then Phase 2 input order) and every failure in `failures` with the same
 * grouping. Neither array reflects completion order.
 *
 * @param ops - Reconciliation operations produced by `diff`, applied in
 *   declaration order.
 * @param registry - Per-kind driver table; dispatch uses `op.desired.kind`
 *   as the index.
 * @returns `Ok(state)` when every op succeeded; otherwise
 *   `Err(AggregateApplyError)` with the survivors and the non-empty
 *   failures tuple.
 * @example
 *
 * ```ts
 * import {
 *     applyOps,
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     type DriverRegistry,
 *     type Operation,
 * } from "@bedrock-rbx/core";
 *
 * const registry: DriverRegistry = {
 *     gamePass: {
 *         async create(desired) {
 *             return {
 *                 data: {
 *                     ...desired,
 *                     outputs: {
 *                         assetId: asRobloxAssetId("9876543210"),
 *                         iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
 *                     },
 *                 },
 *                 success: true,
 *             };
 *         },
 *     },
 *     place: {
 *         async create(desired) {
 *             return {
 *                 data: { ...desired, outputs: { versionNumber: 1 } },
 *                 success: true,
 *             };
 *         },
 *     },
 *     universe: {
 *         async create(desired) {
 *             return {
 *                 data: { ...desired, outputs: { rootPlaceId: asRobloxAssetId("4711") } },
 *                 success: true,
 *             };
 *         },
 *     },
 *     developerProduct: {
 *         async create(desired) {
 *             return {
 *                 data: {
 *                     ...desired,
 *                     outputs: { productId: asRobloxAssetId("8172635495") },
 *                 },
 *                 success: true,
 *             };
 *         },
 *     },
 * };
 *
 * const ops: ReadonlyArray<Operation> = [
 *     {
 *         key: asResourceKey("vip-pass"),
 *         type: "create",
 *         desired: {
 *             key: asResourceKey("vip-pass"),
 *             name: "VIP Pass",
 *             description: "Grants VIP perks.",
 *             icon: { "en-us": "assets/vip-icon.png" },
 *             iconFileHashes: {
 *                 "en-us": asSha256Hex(
 *                     "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *                 ),
 *             },
 *             kind: "gamePass",
 *             price: 500,
 *         },
 *     },
 * ];
 *
 * return applyOps(ops, registry).then((result) => {
 *     expect(result.success).toBe(true);
 *     expect(result.success && result.data).toHaveLength(1);
 * });
 * ```
 */
export async function applyOps(
	ops: ReadonlyArray<Operation>,
	registry: DriverRegistry,
): Promise<Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>> {
	const { phase1, phase2 } = partitionByPhase(ops);
	const applied: Array<ResourceCurrentState> = [];
	const failures: Array<ApplyError> = [];

	for (const op of phase1) {
		const outcome = await dispatchOp(op, registry);
		if (outcome.success) {
			applied.push(outcome.data);
		} else {
			failures.push(outcome.err);
		}
	}

	const phase2Results = await Promise.all(phase2.map(async (op) => dispatchOp(op, registry)));
	failures.push(...collectPhase2Results(phase2Results, applied));

	const [head, ...tail] = failures;
	if (head === undefined) {
		return { data: applied, success: true };
	}

	return { err: { applied, failures: [head, ...tail] }, success: false };
}

function collectPhase2Results(
	results: ReadonlyArray<Result<ResourceCurrentState, ApplyError>>,
	applied: Array<ResourceCurrentState>,
): Array<ApplyError> {
	const failures: Array<ApplyError> = [];
	for (const result of results) {
		if (result.success) {
			applied.push(result.data);
		} else {
			failures.push(result.err);
		}
	}

	return failures;
}

function partitionByPhase(ops: ReadonlyArray<Operation>): {
	readonly phase1: ReadonlyArray<NonNoopOp>;
	readonly phase2: ReadonlyArray<NonNoopOp>;
} {
	const phase1: Array<NonNoopOp> = [];
	const phase2: Array<NonNoopOp> = [];
	for (const op of ops) {
		if (op.type === "noop") {
			continue;
		}

		if (op.desired.kind === "universe") {
			phase1.push(op);
		} else {
			phase2.push(op);
		}
	}

	return { phase1, phase2 };
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

async function applyOne<K extends ResourceKind>(
	op: NonNoopOp & { readonly desired: Extract<ResourceDesiredState, { kind: K }> },
	driver: ResourceDriver<K>,
): Promise<Result<ResourceCurrentState, ApplyError>> {
	if (op.type === "create") {
		const created = await driver.create(op.desired);
		return created.success ? created : driverFailure(op.key, created.err);
	}

	if (driver.update === undefined) {
		return { err: { key: op.key, kind: "updateUnsupported" }, success: false };
	}

	if (op.current.kind !== op.desired.kind) {
		return driverFailure(
			op.key,
			kindMismatch(op.key, { actual: op.current.kind, expected: op.desired.kind }),
		);
	}

	const updated = await driver.update(op.current as ResourceCurrentState<K>, op.desired);
	return updated.success ? updated : driverFailure(op.key, updated.err);
}

async function dispatchByKind(
	op: NonNoopOp,
	registry: DriverRegistry,
): Promise<Result<ResourceCurrentState, ApplyError>> {
	// Exhaustive switch: adding a new ResourceKind is a compile error here
	// until an arm lands. Each arm casts because custom type narrowing does
	// not propagate through a non-distributive union.
	switch (op.desired.kind) {
		case "developerProduct": {
			return applyOne(op as DeveloperProductOp, registry.developerProduct);
		}
		case "gamePass": {
			return applyOne(op as GamePassOp, registry.gamePass);
		}
		case "place": {
			return applyOne(op as PlaceOp, registry.place);
		}
		case "universe": {
			return applyOne(op as UniverseOp, registry.universe);
		}
	}
}

async function dispatchOp(
	op: NonNoopOp,
	registry: DriverRegistry,
): Promise<Result<ResourceCurrentState, ApplyError>> {
	try {
		return await dispatchByKind(op, registry);
	} catch (err) {
		return { err: { key: op.key, cause: err, kind: "unexpectedThrow" }, success: false };
	}
}
