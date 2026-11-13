import type { Result } from "@bedrock-rbx/ocale";

import type { ImportItemKind, ImportSelection } from "../core/import-plan-types.ts";
import type { ResourceLiveState } from "../core/live-state.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import { asRobloxAssetId, type RobloxAssetId } from "../types/ids.ts";
import type { LiveCheckError } from "./read-live-state.ts";

/**
 * Live items of one Kind by Roblox ID.
 *
 * @template K - The importable Kind.
 */
export type LiveItems<K extends ImportItemKind> = ReadonlyMap<RobloxAssetId, ResourceLiveState<K>>;

/** The live items of every importable Kind, empty for a Kind not selected. */
export interface ImportLive {
	/** Live badges. */
	readonly badge: LiveItems<"badge">;
	/** Live developer products. */
	readonly developerProduct: LiveItems<"developerProduct">;
	/** Live game passes. */
	readonly gamePass: LiveItems<"gamePass">;
	/** Live places. */
	readonly place: LiveItems<"place">;
	/** The universe, read for its root place when places were listed. */
	readonly universe?: ReadonlyMap<RobloxAssetId, ResourceLiveState<"universe">>;
}

/** What {@link readLiveAsync} reads. */
export interface ReadLiveOptions {
	/** Whether to list every Kind, selected or not. */
	readonly listAll: boolean;
	/** The items to import. */
	readonly selections: ReadonlyArray<ImportSelection>;
	/** The Environment's universe, read to find the root place. */
	readonly universeId?: string | undefined;
}

/**
 * Read the selected live items of one Environment: list each selected Kind
 * (every Kind with `listAll`), then read any selected item the list did not
 * hold.
 *
 * @param registry - Read-capable Drivers of the Environment.
 * @param options - The items to import, and whether to list every Kind.
 * @returns The live items by Kind, or why a list or read failed.
 */
export async function readLiveAsync(
	registry: DriverRegistry,
	options: ReadLiveOptions,
): Promise<Result<ImportLive, LiveCheckError>> {
	const gamePass = await readKindAsync(registry.gamePass, { ...options, kind: "gamePass" });
	if (!gamePass.success) {
		return gamePass;
	}

	const developerProduct = await readKindAsync(registry.developerProduct, {
		...options,
		kind: "developerProduct",
	});
	if (!developerProduct.success) {
		return developerProduct;
	}

	const badge = await readKindAsync(registry.badge, { ...options, kind: "badge" });
	if (!badge.success) {
		return badge;
	}

	const places = await readPlacesAsync(registry, options);
	if (!places.success) {
		return places;
	}

	return {
		data: {
			badge: badge.data,
			developerProduct: developerProduct.data,
			gamePass: gamePass.data,
			...places.data,
		},
		success: true,
	};
}

function idsOf(
	selections: ReadonlyArray<ImportSelection>,
	kind: ImportItemKind,
): ReadonlyArray<RobloxAssetId> {
	return selections
		.filter((selection) => selection.kind === kind)
		.map(({ robloxId }) => robloxId);
}

async function readKindAsync<K extends ImportItemKind>(
	driver: ResourceDriver<K>,
	{ kind, listAll, selections }: ReadLiveOptions & { readonly kind: K },
): Promise<Result<LiveItems<K>, LiveCheckError>> {
	const ids = idsOf(selections, kind);
	if (!listAll && ids.length === 0) {
		return { data: new Map(), success: true };
	}

	const listed = (await driver.list?.()) ?? { data: new Map(), success: true };
	if (!listed.success) {
		return {
			err: { cause: listed.err, kind: "liveCheckFailed", resourceKind: kind },
			success: false,
		};
	}

	const items = new Map(listed.data);
	const unlisted = ids.filter((wanted) => !items.has(wanted));
	for (const id of unlisted) {
		const read = await driver.read?.(id);
		if (read?.success === false) {
			return {
				err: { cause: read.err, kind: "liveCheckFailed", resourceKind: kind },
				success: false,
			};
		}

		if (read?.data !== undefined) {
			items.set(id, read.data);
		}
	}

	return { data: items, success: true };
}

/**
 * Read the universe when places were listed, so the root place is known.
 *
 * @param driver - The universe Driver.
 * @param read - The listed places and the universe to read.
 * @returns The universe by ID, nothing when it was not read, or the failure.
 */
async function readRootAsync(
	driver: ResourceDriver<"universe">,
	{
		places,
		universeId,
	}: { readonly places: LiveItems<"place">; readonly universeId: string | undefined },
): Promise<Result<Pick<ImportLive, "universe">, LiveCheckError>> {
	if (universeId === undefined || places.size === 0 || driver.read === undefined) {
		return { data: {}, success: true };
	}

	const id = asRobloxAssetId(universeId);
	const read = await driver.read(id);
	if (!read.success) {
		return {
			err: { cause: read.err, kind: "liveCheckFailed", resourceKind: "universe" },
			success: false,
		};
	}

	return {
		data: read.data === undefined ? {} : { universe: new Map([[id, read.data]]) },
		success: true,
	};
}

/**
 * Read the places, and the universe for its root place when any is listed.
 *
 * @param registry - Read-capable Drivers of the Environment.
 * @param options - The items to import and the universe to read.
 * @returns The places and the universe, or why a read failed.
 */
async function readPlacesAsync(
	registry: DriverRegistry,
	options: ReadLiveOptions,
): Promise<Result<Pick<ImportLive, "place" | "universe">, LiveCheckError>> {
	const place = await readKindAsync(registry.place, { ...options, kind: "place" });
	if (!place.success) {
		return place;
	}

	const universe = await readRootAsync(registry.universe, {
		places: place.data,
		universeId: options.universeId,
	});
	return universe.success
		? { data: { place: place.data, ...universe.data }, success: true }
		: universe;
}
