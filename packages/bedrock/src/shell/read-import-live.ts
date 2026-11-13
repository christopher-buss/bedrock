import type { Result } from "@bedrock-rbx/ocale";

import type { ImportKind } from "../core/import-current.ts";
import type { ImportSelection } from "../core/import-plan.ts";
import type { ResourceLiveState } from "../core/live-state.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { RobloxAssetId } from "../types/ids.ts";
import type { LiveCheckError } from "./read-live-state.ts";

/**
 * Live items of one Kind by Roblox ID.
 *
 * @template K - The importable Kind.
 */
export type LiveItems<K extends ImportKind> = ReadonlyMap<RobloxAssetId, ResourceLiveState<K>>;

/** The live items of every importable Kind, empty for a Kind not selected. */
export interface ImportLive {
	/** Live badges. */
	readonly badge: LiveItems<"badge">;
	/** Live developer products. */
	readonly developerProduct: LiveItems<"developerProduct">;
	/** Live game passes. */
	readonly gamePass: LiveItems<"gamePass">;
}

/** What {@link readLiveAsync} reads. */
export interface ReadLiveOptions {
	/** Whether to list every Kind, selected or not. */
	readonly listAll: boolean;
	/** The items to import. */
	readonly selections: ReadonlyArray<ImportSelection>;
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

	return {
		data: {
			badge: badge.data,
			developerProduct: developerProduct.data,
			gamePass: gamePass.data,
		},
		success: true,
	};
}

function idsOf(
	selections: ReadonlyArray<ImportSelection>,
	kind: ImportKind,
): ReadonlyArray<RobloxAssetId> {
	return selections
		.filter((selection) => selection.kind === kind)
		.map(({ robloxId }) => robloxId);
}

async function readKindAsync<K extends ImportKind>(
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
