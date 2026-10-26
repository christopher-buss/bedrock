import type { RetiredInput } from "./flatten.ts";
import { changedFieldsBetween } from "./kinds/dispatch.ts";
import type { Operation } from "./operations.ts";
import { rebindCurrent } from "./rebind-current.ts";
import type { ResourceCurrentState, ResourceDesiredState, ResourceKind } from "./resources.ts";

/**
 * Diff an already-rebound baseline. Stage orchestration uses the full config
 * to rebind first, so a withheld artifact never becomes a rename candidate.
 *
 * @param desired - Desired entries admitted by the current stage.
 * @param current - Baseline rebound against the full environment config.
 * @returns Operations for this stage, without transient rename declarations.
 */
export function diffRebound(
	desired: ReadonlyArray<ResourceDesiredState | RetiredInput>,
	current: ReadonlyArray<ResourceCurrentState>,
): ReadonlyArray<Operation> {
	const currentByKey = new Map(current.map((entry) => [compositeKey(entry), entry]));
	return desired.map((entry) => {
		if ("retired" in entry) {
			return operationFor(entry, currentByKey.get(compositeKey(entry)));
		}

		const { movedFrom, ...live } = entry;
		return operationFor(
			movedFrom === undefined ? entry : live,
			currentByKey.get(compositeKey(entry)),
		);
	});
}

/**
 * Computes the operations required to reconcile `current` state with `desired`
 * state. Pure and synchronous: no I/O or side effects. Preflight refusals
 * throw; deploy and preview return these as typed `BuildDesiredError`
 * failures.
 *
 * Each entry in `desired` is matched to `current` by `(kind, key)`: resources
 * are uniquely identified by that pair, so a `place` and a `universe` keyed
 * `"main"` are independent slots. A `(kind, key)` pair present only in
 * `desired` produces a `create` op; a pair present in both produces an
 * `update` op if any declared field differs or a `noop` op if every field
 * matches. Current-only entries are refused after resolving explicit renames
 * and implicit place-ID adoption. Declare `retired: true`, `retired:
 * "untrack"`, or `movedFrom` to resolve them. Matching always includes the
 * kind as well as the key.
 *
 * Ops appear in the order their desired entries appear in the input array.
 * `applyOps` regroups them into Phase 1 (universe) and Phase 2 (everything
 * else) when dispatching; the execution order within Phase 2 is not
 * guaranteed because Phase 2 dispatches concurrently. Persisted state-file
 * order is determined by the merge in `deploy.runReconcile` (which retains
 * prior-snapshot positions for unchanged keys), not by this diff output.
 *
 * @since 0.1.0
 *
 * @param desired - Declared desired state from user config, already normalized
 *   (file hashes computed, nullable wire values mapped to `undefined`).
 * @param current - Last-known current state from the state file.
 * @returns Operations to reconcile the two snapshots.
 * @throws When an orphan remains, universe removal is requested, or a rename
 * would merge occupied keys or cross resource kinds.
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     diff,
 *     type GamePassDesiredState,
 *     type ResourceCurrentState,
 * } from "@bedrock-rbx/core";
 *
 * const hash = asSha256Hex(
 *     "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 * );
 *
 * const unchanged: GamePassDesiredState = {
 *     description: "Grants VIP perks.",
 *     icon: { "en-us": "assets/vip-icon.png" },
 *     iconFileHashes: { "en-us": hash },
 *     key: asResourceKey("vip-pass"),
 *     kind: "gamePass",
 *     name: "VIP Pass",
 *     price: 500,
 * };
 * const drifted: GamePassDesiredState = {
 *     ...unchanged,
 *     key: asResourceKey("legend-pass"),
 *     name: "Legend Pass (renamed)",
 * };
 * const fresh: GamePassDesiredState = {
 *     ...unchanged,
 *     key: asResourceKey("rookie-pass"),
 *     name: "Rookie Pass",
 * };
 *
 * const current: ReadonlyArray<ResourceCurrentState> = [
 *     {
 *         ...unchanged,
 *         outputs: {
 *             assetId: asRobloxAssetId("111"),
 *             iconAssetIds: { "en-us": asRobloxAssetId("222") },
 *         },
 *     },
 *     {
 *         ...drifted,
 *         name: "Legend Pass",
 *         outputs: {
 *             assetId: asRobloxAssetId("333"),
 *             iconAssetIds: { "en-us": asRobloxAssetId("444") },
 *         },
 *     },
 * ];
 *
 * const ops = diff([unchanged, drifted, fresh], current);
 *
 * expect(ops.map((op) => op.type)).toEqual(["noop", "update", "create"]);
 *
 * const updateOp = ops[1]!;
 * if (updateOp.type === "update") {
 *     expect(updateOp.changedFields).toStrictEqual(["name"]);
 * }
 *
 * // An absent declaration is refused, including for programmatic consumers.
 * expect(() => diff([], current)).toThrow("gamePass:vip-pass");
 * ```
 */
export function diff(
	desired: ReadonlyArray<ResourceDesiredState | RetiredInput>,
	current: ReadonlyArray<ResourceCurrentState>,
): ReadonlyArray<Operation> {
	const rebound = rebindCurrent(desired, { resources: current });
	if (!rebound.success) {
		throw new Error(rebound.err.message);
	}

	return diffRebound(desired, rebound.data.resources);
}

function compositeKey(resource: { readonly key: string; readonly kind: ResourceKind }): string {
	return `${resource.kind}:${resource.key}`;
}

function isUniverse(resource: { readonly kind: ResourceKind }): boolean {
	return resource.kind === "universe";
}

function operationFor(
	desired: ResourceDesiredState | RetiredInput,
	current: ResourceCurrentState | undefined,
): Operation {
	if ("retired" in desired) {
		if (current?.kind === "universe" || isUniverse(desired)) {
			throw new Error("Universe removal is not available at this time.");
		}

		return current === undefined
			? { key: desired.key, kind: desired.kind, type: "noop" }
			: { key: desired.key, current, type: desired.retired === true ? "retire" : "untrack" };
	}

	if (current === undefined) {
		return { key: desired.key, desired, type: "create" };
	}

	const changedFields = changedFieldsBetween(desired, current);
	if (changedFields.length === 0) {
		return { key: desired.key, kind: desired.kind, type: "noop" };
	}

	return { key: desired.key, changedFields, current, desired, type: "update" };
}
