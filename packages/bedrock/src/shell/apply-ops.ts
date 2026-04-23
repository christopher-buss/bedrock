import { ApiError, type OpenCloudError, type Result } from "@bedrock/ocale";

import type { Operation } from "../core/operations.ts";
import type { GamePassDesiredState, PlaceDesiredState } from "../core/resources.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { ResourceKey } from "../types/ids.ts";

/**
 * Failure surfaced by `applyOps` when an operation cannot be applied.
 * Plain-data discriminated union; narrow on `kind`, do not `instanceof` it.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type ApplyError } from "bedrock";
 *
 * function describe(err: ApplyError): string {
 *     switch (err.kind) {
 *         case "driverFailure": {
 *             return `driver failed for ${err.key}: ${err.cause.message}`;
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
			readonly key: ResourceKey;
			readonly kind: "updateUnsupported";
	  };

type NonNoopOp = Exclude<Operation, { readonly type: "noop" }>;
type GamePassOp = NonNoopOp & { readonly desired: GamePassDesiredState };
type PlaceOp = NonNoopOp & { readonly desired: PlaceDesiredState };

/**
 * Dispatch each reconciliation operation to the matching resource driver
 * with first-fail semantics: on the first `Err` (driver failure or
 * `updateUnsupported`), the remaining operations are skipped and the error
 * is returned verbatim.
 *
 * Behaviour:
 * - `create` operations are routed to `registry[op.desired.kind].create`.
 * - `update` operations are routed to `registry[op.desired.kind].update`
 *   when the driver exposes it; otherwise they short-circuit to an
 *   `updateUnsupported` Err without invoking the driver.
 * - `noop` operations are skipped entirely (no I/O, no dispatch).
 *
 * @param ops - Reconciliation operations produced by `diff`, applied in order.
 * @param registry - Per-kind driver table; dispatch uses `op.desired.kind` as the index.
 * @returns `Ok(undefined)` when every operation succeeds, or the first failure encountered.
 * @throws Whatever the dispatched driver rejects with outside its `Result`
 *   return. A driver whose injected I/O (file reads, network calls, etc.)
 *   throws will surface that rejection here rather than translating it into
 *   a `Result` failure; wrap the call site in a try/catch when drivers are
 *   not trusted to contain their own rejections.
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
 * } from "bedrock";
 *
 * const registry: DriverRegistry = {
 *     gamePass: {
 *         async create(desired) {
 *             return {
 *                 data: {
 *                     ...desired,
 *                     outputs: {
 *                         assetId: asRobloxAssetId("9876543210"),
 *                         iconAssetId: asRobloxAssetId("1122334455"),
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
 *             iconFileHash: asSha256Hex(
 *                 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *             ),
 *             iconFilePath: "assets/vip-icon.png",
 *             kind: "gamePass",
 *             price: 500,
 *         },
 *     },
 * ];
 *
 * return applyOps(ops, registry).then((result) => {
 *     expect(result).toStrictEqual({ data: undefined, success: true });
 * });
 * ```
 */
export async function applyOps(
	ops: ReadonlyArray<Operation>,
	registry: DriverRegistry,
): Promise<Result<undefined, ApplyError>> {
	for (const op of ops) {
		if (op.type === "noop") {
			continue;
		}

		const outcome = isGamePassOp(op)
			? await applyGamePass(op, registry.gamePass)
			: await applyPlace(toPlaceOp(op), registry.place);
		if (!outcome.success) {
			return outcome;
		}
	}

	return { data: undefined, success: true };
}

function isGamePassOp(op: NonNoopOp): op is GamePassOp {
	return op.desired.kind === "gamePass";
}

function driverFailure(key: ResourceKey, cause: OpenCloudError): Result<undefined, ApplyError> {
	return { err: { key, cause, kind: "driverFailure" }, success: false };
}

function kindMismatch(key: ResourceKey, mismatch: { actual: string; expected: string }): ApiError {
	return new ApiError(
		`internal: operation kind mismatch for ${key}: expected ${mismatch.expected}, got ${mismatch.actual}`,
		{ statusCode: 0 },
	);
}

async function applyGamePass(
	op: GamePassOp,
	driver: ResourceDriver<"gamePass">,
): Promise<Result<undefined, ApplyError>> {
	if (op.type === "create") {
		const created = await driver.create(op.desired);
		return created.success
			? { data: undefined, success: true }
			: driverFailure(op.key, created.err);
	}

	if (driver.update === undefined) {
		return { err: { key: op.key, kind: "updateUnsupported" }, success: false };
	}

	if (op.current.kind !== "gamePass") {
		return driverFailure(
			op.key,
			kindMismatch(op.key, { actual: op.current.kind, expected: "gamePass" }),
		);
	}

	const updated = await driver.update(op.current, op.desired);
	return updated.success
		? { data: undefined, success: true }
		: driverFailure(op.key, updated.err);
}

async function applyPlace(
	op: PlaceOp,
	driver: ResourceDriver<"place">,
): Promise<Result<undefined, ApplyError>> {
	if (op.type === "create") {
		const created = await driver.create(op.desired);
		return created.success
			? { data: undefined, success: true }
			: driverFailure(op.key, created.err);
	}

	if (driver.update === undefined) {
		return { err: { key: op.key, kind: "updateUnsupported" }, success: false };
	}

	if (op.current.kind !== "place") {
		return driverFailure(
			op.key,
			kindMismatch(op.key, { actual: op.current.kind, expected: "place" }),
		);
	}

	const updated = await driver.update(op.current, op.desired);
	return updated.success
		? { data: undefined, success: true }
		: driverFailure(op.key, updated.err);
}

function toPlaceOp(op: NonNoopOp): PlaceOp {
	// Callers only reach this after `isGamePassOp(op) === false`, and
	// `ResourceKind` is `"gamePass" | "place"`, so `op` is necessarily a
	// `PlaceOp` here. TypeScript can't follow the narrowing cascade through a
	// non-distributive union, so the assertion stands in for the proof.
	return op as PlaceOp;
}
