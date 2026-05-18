import { defaultKindRegistry } from "./kinds/index.ts";
import type { ResourceKindModule } from "./kinds/module.ts";
import type { Operation } from "./operations.ts";
import type { ResourceCurrentState, ResourceDesiredState, ResourceKind } from "./resources.ts";

/**
 * Computes the operations required to reconcile `current` state with `desired`
 * state. Pure and synchronous: no I/O, no side effects, no `Result` wrapper.
 *
 * Each entry in `desired` is matched to `current` by `(kind, key)`: resources
 * are uniquely identified by that pair, so a `place` and a `universe` keyed
 * `"main"` are independent slots. A `(kind, key)` pair present only in
 * `desired` produces a `create` op; a pair present in both produces an
 * `update` op if any declared field differs or a `noop` op if every field
 * matches.
 *
 * Ops appear in the order their desired entries appear in the input array so
 * callers can rely on declaration order when logging or applying ops.
 *
 * @param desired - Declared desired state from user config, already normalized
 *   (file hashes computed, nullable wire values mapped to `undefined`).
 * @param current - Last-known live state from the state file.
 * @returns Operations to reconcile the two snapshots.
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
 * ```
 */
export function diff(
	desired: ReadonlyArray<ResourceDesiredState>,
	current: ReadonlyArray<ResourceCurrentState>,
): ReadonlyArray<Operation> {
	const currentByKey = new Map(current.map((entry) => [compositeKey(entry), entry]));
	return desired.map((entry) => operationFor(entry, currentByKey.get(compositeKey(entry))));
}

function compositeKey(resource: { readonly key: string; readonly kind: ResourceKind }): string {
	return `${resource.kind}:${resource.key}`;
}

function operationFor(
	desired: ResourceDesiredState,
	current: ResourceCurrentState | undefined,
): Operation {
	if (current === undefined) {
		return { key: desired.key, desired, type: "create" };
	}

	// Composite-key matching guarantees `desired.kind === current.kind`,
	// so the per-kind module is consulted directly without a kind guard.
	const module = defaultKindRegistry[desired.kind] as ResourceKindModule<ResourceKind>;
	const changedFields = module.changedFieldsBetween(desired, current);
	if (changedFields.length === 0) {
		return { key: desired.key, type: "noop" };
	}

	return { key: desired.key, changedFields, current, desired, type: "update" };
}
