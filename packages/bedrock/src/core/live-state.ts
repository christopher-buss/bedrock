import type { Except } from "type-fest";

import type { ResourceKey, RobloxAssetId } from "../types/ids.ts";
import { changedFieldsBetween } from "./kinds/dispatch.ts";
import type { ResourceCurrentState, ResourceKind, ResourceOutputs } from "./resources.ts";

/**
 * Values Roblox can return, in the Current state shape. An absent field is
 * unreadable; a present `undefined` is a value, such as an off-sale price.
 * Local paths and file hashes are left absent. List entries have no config Key.
 * @template K - Kind read by the Driver.
 * @since unreleased
 */
export type ResourceLiveState<K extends ResourceKind = ResourceKind> = K extends ResourceKind
	? Readonly<Partial<Except<ResourceCurrentState<K>, "key" | "kind" | "outputs">>> & {
			readonly kind: K;
			readonly outputs: Readonly<Partial<ResourceOutputs<K>>>;
		}
	: never;

/**
 * Live lists indexed by Roblox ID, read once per Kind for a run.
 * @since unreleased
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
 * @param current - Saved Current state, after Key renames.
 * @param snapshot - Complete live lists; an absent Kind was not checked.
 * @returns Field-level edits, missing tracked resources, and a live baseline.
 * @since unreleased
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

function compareResource<K extends ResourceKind>(
	saved: ResourceCurrentState<K>,
	live: ResourceLiveState<K>,
): { readonly fields: OutOfBandEdit["fields"]; readonly refreshed: ResourceCurrentState } {
	const refreshed: ResourceCurrentState<K> = {
		...saved,
		...live,
		outputs: { ...saved.outputs, ...live.outputs },
	};
	const savedValues: ReadonlyMap<string, unknown> = new Map(Object.entries(saved));
	const liveValues: ReadonlyMap<string, unknown> = new Map(Object.entries(refreshed));
	const fields = changedFieldsBetween(refreshed, saved).map((field) => {
		return {
			current: savedValues.get(field),
			field,
			live: liveValues.get(field),
		};
	});
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
