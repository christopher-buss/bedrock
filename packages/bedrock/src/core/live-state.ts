import type { Except } from "type-fest";

import type { ResourceKey, RobloxAssetId } from "../types/ids.ts";
import { changedFieldsBetween } from "./kinds/dispatch.ts";
import type { ResourceCurrentState, ResourceKind, ResourceOutputs } from "./resources.ts";

const fieldOrder = new Intl.Collator();

/**
 * Values Roblox can return, in the Current state shape. An absent field is
 * unreadable; a present `undefined` is a value, such as an off-sale price.
 * Local paths and file hashes are left absent. List entries have no config Key.
 * Outputs use the same presence rule: an omitted icon ID is unreadable;
 * a present `undefined` means Roblox reports no source-language icon.
 * @template K - Kind read by the Driver.
 * @since unreleased
 *
 * @example
 * ```ts
 * import { type ResourceLiveState } from "@bedrock-rbx/core";
 *
 * const live: ResourceLiveState<"gamePass"> = {
 *     kind: "gamePass", outputs: {}, price: undefined,
 * };
 * expect("price" in live).toBe(true); // Readable and off sale.
 * expect("iconFileHashes" in live).toBe(false); // Unreadable, not cleared.
 * ```
 */
export type ResourceLiveState<K extends ResourceKind = ResourceKind> = K extends ResourceKind
	? Readonly<Partial<Except<ResourceCurrentState<K>, "key" | "kind" | "outputs">>> & {
			readonly kind: K;
			readonly outputs: {
				readonly [Field in keyof ResourceOutputs<K>]?: Field extends
					| "iconAssetIds"
					| "iconImageId"
					? ResourceOutputs<K>[Field] | undefined
					: ResourceOutputs<K>[Field];
			};
		}
	: never;

/**
 * Complete Live lists indexed by Roblox ID. An absent Kind is unchecked;
 * an empty map means it was checked and no resources exist. Only tracked IDs
 * participate in compare and refresh; extra items are never imported.
 * @since unreleased
 *
 * @example
 * ```ts
 * import { type LiveSnapshot } from "@bedrock-rbx/core";
 *
 * const snapshot: LiveSnapshot = { gamePass: new Map() };
 * expect(snapshot.gamePass?.size).toBe(0); // Checked: all tracked passes are missing.
 * expect(snapshot.badge).toBeUndefined(); // Unchecked: keep saved badges.
 * ```
 */
export type LiveSnapshot = {
	[K in ResourceKind]?: ReadonlyMap<RobloxAssetId, ResourceLiveState<K>>;
};

/**
 * Field-level disagreement between saved Current state and Live state.
 * @since unreleased
 */
export interface OutOfBandEdit {
	/** Config Key of the edited resource. */
	readonly key: ResourceKey;
	/** Changed managed fields, with saved and live values. */
	readonly fields: ReadonlyArray<{
		/** Value saved by the previous Deploy. */
		readonly current: unknown;
		/** Managed field name. */
		readonly field: string;
		/** Value read from Roblox. */
		readonly live: unknown;
	}>;
	/** Kind of the edited resource. */
	readonly kind: ResourceKind;
}

/**
 * A saved resource absent from a completely read live list.
 * @since unreleased
 */
export interface MissingLiveResource {
	/** Config Key of the missing resource. */
	readonly key: ResourceKey;
	/** Kind of the missing resource. */
	readonly kind: ResourceKind;
	/** Previously recorded Roblox ID. */
	readonly robloxId: RobloxAssetId;
}

/**
 * Compare saved state with readable live fields, retaining unreadable values.
 * Managed local icons compare their saved source-language asset ID before
 * Outputs refresh and report an `icon` edit containing the old and live IDs.
 * An unknown saved ID supplies no comparison baseline. Readable absent icons
 * are edits; required game-pass and badge IDs retain their last-known value
 * in the refreshed resources until a successful upload supplies a new one.
 * @param current - Saved Current state, after Key renames.
 * @param snapshot - Complete live lists; an absent Kind was not checked.
 * @returns Field-level edits, missing tracked resources, and a live baseline.
 * @since unreleased
 *
 * @example
 * ```ts
 * import {
 *     asResourceKey, asRobloxAssetId, compareLiveState,
 *     type ResourceCurrentState,
 * } from "@bedrock-rbx/core";
 *
 * const saved: ResourceCurrentState<"developerProduct"> = {
 *     key: asResourceKey("gems"), kind: "developerProduct",
 *     name: "Gems", description: "100 gems", price: 100,
 *     outputs: { productId: asRobloxAssetId("123") },
 * };
 * const compared = compareLiveState([saved], {
 *     developerProduct: new Map([[saved.outputs.productId, {
 *         kind: "developerProduct", outputs: {}, price: 120,
 *     }]]),
 * });
 * expect(compared.edits).toEqual([{
 *     key: "gems", kind: "developerProduct",
 *     fields: [{ field: "price", current: 100, live: 120 }],
 * }]);
 * expect(compared.resources).toEqual([{ ...saved, price: 120 }]);
 * expect(compared.missing).toEqual([]);
 * expect(saved.price).toBe(100);
 * ```
 *
 * @example
 * A readable missing icon still needs restoration even when its file is unchanged.
 * ```ts
 * import {
 *     asResourceKey, asRobloxAssetId, asSha256Hex, compareLiveState,
 *     type ResourceCurrentState,
 * } from "@bedrock-rbx/core";
 * const saved: ResourceCurrentState<"badge"> = {
 *     key: asResourceKey("winner"), kind: "badge", name: "Winner",
 *     description: "Win a round", enabled: true, icon: { "en-us": "winner.png"
 *     }, iconFileHashes: { "en-us": asSha256Hex("a".repeat(64)) }, outputs: {
 *     badgeId: asRobloxAssetId("123"), iconImageId: asRobloxAssetId("456") },
 * };
 * const compared = compareLiveState([saved], {
 *     badge: new Map([[saved.outputs.badgeId, {
 *         kind: "badge", outputs: { iconImageId: undefined },
 *     }]]),
 * });
 * expect(compared.edits[0]!.fields).toEqual([
 *     { field: "icon", current: "456", live: undefined },
 * ]);
 * expect(compared.resources[0]).toEqual(saved); // Retain the last-known required ID.
 * ```
 */
export function compareLiveState(
	current: ReadonlyArray<ResourceCurrentState>,
	snapshot: LiveSnapshot,
): {
	readonly edits: ReadonlyArray<OutOfBandEdit>;
	readonly missing: ReadonlyArray<MissingLiveResource>;
	readonly resources: ReadonlyArray<ResourceCurrentState>;
} {
	const edits: Array<OutOfBandEdit> = [];
	const missing: Array<MissingLiveResource> = [];
	const resources = current.map((saved) => {
		const listed = snapshot[saved.kind];
		if (listed === undefined) {
			return saved;
		}

		const robloxId = resourceRobloxId(saved);
		const live = listed.get(robloxId);
		if (live === undefined) {
			missing.push({ key: saved.key, kind: saved.kind, robloxId });
			return saved;
		}

		const compared = compareResource(saved, live);
		if (compared.fields.length > 0) {
			edits.push({ key: saved.key, fields: compared.fields, kind: saved.kind });
		}

		return compared.refreshed;
	});
	return { edits, missing, resources };
}

function readableIconId({
	outputs,
}: ResourceCurrentState | ResourceLiveState):
	| undefined
	| { readonly value: RobloxAssetId | undefined } {
	if ("iconAssetIds" in outputs) {
		return { value: outputs.iconAssetIds?.["en-us"] };
	}

	if ("iconImageAssetId" in outputs) {
		return { value: outputs.iconImageAssetId };
	}

	return "iconImageId" in outputs ? { value: outputs.iconImageId } : undefined;
}

function compareIcon(
	saved: ResourceCurrentState,
	live: ResourceLiveState,
): OutOfBandEdit["fields"][number] | undefined {
	if (!("icon" in saved)) {
		return undefined;
	}

	const current = readableIconId(saved);
	const observed = readableIconId(live);
	if (
		observed === undefined ||
		current?.value === undefined ||
		current.value === observed.value
	) {
		return undefined;
	}

	return { current: current.value, field: "icon", live: observed.value };
}

function compareResource<K extends ResourceKind>(
	saved: ResourceCurrentState<K>,
	live: ResourceLiveState<K>,
): { readonly fields: OutOfBandEdit["fields"]; readonly refreshed: ResourceCurrentState } {
	const outputValues: ReadonlyMap<string, unknown> = new Map(Object.entries(live.outputs));
	const liveOutputs = Object.fromEntries(
		[...outputValues].filter(([field, value]) => {
			return value !== undefined || (field !== "iconAssetIds" && field !== "iconImageId");
		}),
	);
	const refreshed: ResourceCurrentState<K> = {
		...saved,
		...live,
		outputs: { ...saved.outputs, ...liveOutputs },
	};
	const savedValues: ReadonlyMap<string, unknown> = new Map(Object.entries(saved));
	const liveValues: ReadonlyMap<string, unknown> = new Map(Object.entries(refreshed));
	const fields = changedFieldsBetween(saved, refreshed).map((field) => {
		return {
			current: savedValues.get(field),
			field,
			live: liveValues.get(field),
		};
	});
	const icon = compareIcon(saved, live);
	if (icon !== undefined) {
		fields.push(icon);
		fields.sort((left, right) => fieldOrder.compare(left.field, right.field));
	}

	return { fields, refreshed };
}

function resourceRobloxId(current: ResourceCurrentState): RobloxAssetId {
	switch (current.kind) {
		case "badge": {
			return current.outputs.badgeId;
		}
		case "developerProduct": {
			return current.outputs.productId;
		}
		case "gamePass": {
			return current.outputs.assetId;
		}
		case "place": {
			return current.placeId;
		}
		case "universe": {
			return current.universeId;
		}
	}
}
