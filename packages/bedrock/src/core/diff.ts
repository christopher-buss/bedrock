import type { Operation } from "./operations.ts";
import type { ResourceCurrentState, ResourceDesiredState } from "./resources.ts";

/**
 * Computes the operations required to reconcile `current` state with `desired`
 * state. Pure and synchronous: no I/O, no side effects, no `Result` wrapper.
 *
 * Each entry in `desired` is matched to `current` by `key`. A key present only
 * in `desired` produces a `create` op; a key present in both produces an
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
 * } from "bedrock";
 *
 * const hash = asSha256Hex(
 *     "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 * );
 *
 * const unchanged: GamePassDesiredState = {
 *     description: "Grants VIP perks.",
 *     iconFileHash: hash,
 *     iconFilePath: "assets/vip-icon.png",
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
 *             iconAssetId: asRobloxAssetId("222"),
 *         },
 *     },
 *     {
 *         ...drifted,
 *         name: "Legend Pass",
 *         outputs: {
 *             assetId: asRobloxAssetId("333"),
 *             iconAssetId: asRobloxAssetId("444"),
 *         },
 *     },
 * ];
 *
 * const ops = diff([unchanged, drifted, fresh], current);
 *
 * expect(ops.map((op) => op.type)).toEqual(["noop", "update", "create"]);
 * ```
 */
export function diff(
	desired: ReadonlyArray<ResourceDesiredState>,
	current: ReadonlyArray<ResourceCurrentState>,
): ReadonlyArray<Operation> {
	const currentByKey = new Map(current.map((entry) => [entry.key, entry]));
	const ops: Array<Operation> = [];
	for (const desiredEntry of desired) {
		const currentEntry = currentByKey.get(desiredEntry.key);
		if (currentEntry === undefined) {
			ops.push({
				key: desiredEntry.key,
				desired: desiredEntry,
				type: "create",
			});
			continue;
		}

		if (desiredFieldsEqual(desiredEntry, currentEntry)) {
			ops.push({ key: desiredEntry.key, type: "noop" });
			continue;
		}

		ops.push({
			key: desiredEntry.key,
			current: currentEntry,
			desired: desiredEntry,
			type: "update",
		});
	}

	return ops;
}

function desiredFieldsEqual(desired: ResourceDesiredState, current: ResourceCurrentState): boolean {
	switch (desired.kind) {
		case "gamePass": {
			if (current.kind !== "gamePass") {
				return false;
			}

			return (
				desired.name === current.name &&
				desired.description === current.description &&
				desired.iconFileHash === current.iconFileHash &&
				desired.iconFilePath === current.iconFilePath &&
				desired.price === current.price
			);
		}
		case "place": {
			if (current.kind !== "place") {
				return false;
			}

			return (
				desired.placeId === current.placeId &&
				desired.filePath === current.filePath &&
				desired.fileHash === current.fileHash
			);
		}
	}
}
