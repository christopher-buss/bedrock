import type { Operation } from "./operations.ts";
import type {
	GamePassDesiredState,
	PlaceDesiredState,
	ResourceCurrentState,
	ResourceDesiredState,
	UniverseDesiredState,
} from "./resources.ts";
import { UNIVERSE_MANAGED_FLAGS } from "./resources.ts";

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
 * } from "@bedrock/core";
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
	return desired.map((entry) => operationFor(entry, currentByKey.get(entry.key)));
}

// Resource-kind identity keys. Every field on a `ResourceDesiredState`
// that is not in this set is a user-managed field; `hasNoManagedFields`
// returns true when no non-identity key is present on the object. Only
// universe supports "all optional → noop on apply"; the other kinds'
// required fields (name, description, filePath, etc.) are always present,
// so the loop naturally returns false for them without a kind guard.
const IDENTITY_KEYS: ReadonlySet<string> = new Set([
	"key",
	"kind",
	"placeId",
	"universeId",
] satisfies Array<
	keyof GamePassDesiredState | keyof PlaceDesiredState | keyof UniverseDesiredState
>);

function hasNoManagedFields(desired: ResourceDesiredState): boolean {
	if ("privateServerPriceRobux" in desired) {
		return false;
	}

	for (const [key, value] of Object.entries(desired)) {
		if (!IDENTITY_KEYS.has(key) && value !== undefined) {
			return false;
		}
	}

	return true;
}

function gamePassFieldsEqual(
	desired: GamePassDesiredState,
	current: ResourceCurrentState<"gamePass">,
): boolean {
	return (
		desired.name === current.name &&
		desired.description === current.description &&
		desired.iconFileHash === current.iconFileHash &&
		desired.iconFilePath === current.iconFilePath &&
		desired.price === current.price
	);
}

function placeFieldsEqual(
	desired: PlaceDesiredState,
	current: ResourceCurrentState<"place">,
): boolean {
	return (
		desired.placeId === current.placeId &&
		desired.filePath === current.filePath &&
		desired.fileHash === current.fileHash
	);
}

function universeFieldsEqual(
	desired: UniverseDesiredState,
	current: ResourceCurrentState<"universe">,
): boolean {
	if (desired.universeId !== current.universeId) {
		return false;
	}

	// Only compare flags the user has declared. An undeclared flag stays
	// owned by whoever else writes to the universe (Creator Hub, another
	// tool), so a concrete current value for it is not drift.
	for (const flag of UNIVERSE_MANAGED_FLAGS) {
		const isDesiredEnabled = desired[flag];
		if (isDesiredEnabled !== undefined && isDesiredEnabled !== current[flag]) {
			return false;
		}
	}

	if (desired.displayName !== undefined && desired.displayName !== current.displayName) {
		return false;
	}

	if (desired.visibility !== undefined && desired.visibility !== current.visibility) {
		return false;
	}

	if (
		"privateServerPriceRobux" in desired &&
		desired.privateServerPriceRobux !== current.privateServerPriceRobux
	) {
		return false;
	}

	return true;
}

function desiredFieldsEqual(desired: ResourceDesiredState, current: ResourceCurrentState): boolean {
	switch (desired.kind) {
		case "gamePass": {
			return current.kind === "gamePass" && gamePassFieldsEqual(desired, current);
		}
		case "place": {
			return current.kind === "place" && placeFieldsEqual(desired, current);
		}
		case "universe": {
			return current.kind === "universe" && universeFieldsEqual(desired, current);
		}
	}
}

function operationFor(
	desired: ResourceDesiredState,
	current: ResourceCurrentState | undefined,
): Operation {
	if (hasNoManagedFields(desired)) {
		return { key: desired.key, type: "noop" };
	}

	if (current === undefined) {
		return { key: desired.key, desired, type: "create" };
	}

	if (desiredFieldsEqual(desired, current)) {
		return { key: desired.key, type: "noop" };
	}

	return { key: desired.key, current, desired, type: "update" };
}
