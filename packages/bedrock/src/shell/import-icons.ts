import type { OpenCloudError } from "@bedrock-rbx/ocale";

import type { ImportKind } from "../core/import-current.ts";
import { importIconPath } from "../core/import-key.ts";
import type { ImportIcon, ImportItem, ImportSelection } from "../core/import-plan-types.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { RobloxAssetId } from "../types/ids.ts";
import type { ImportLive, LiveItems } from "./read-import-live.ts";

/** An item whose stored icon could not be downloaded. */
export interface IconFallback {
	/** Key of the entry. */
	readonly key: string;
	/** Why the download failed, when Roblox said. */
	readonly cause: OpenCloudError | undefined;
	/** Kind of the item. */
	readonly kind: ImportKind;
	/** Where the user must put the icon file. */
	readonly path: string;
	/** Roblox ID of the item. */
	readonly robloxId: RobloxAssetId;
}

/** Writes a downloaded icon. */
interface IconWriter {
	/** Writes the file at `path`. */
	readonly writeFile: (path: string, contents: string | Uint8Array) => Promise<void>;
}

interface DownloadedIcon extends ImportIcon {
	readonly cause: OpenCloudError | undefined;
	readonly item: ImportItem;
}

/**
 * Download the stored icons of the selected untracked items. An item whose
 * icon cannot be downloaded falls back to a file the user supplies.
 *
 * @param options - Writes the downloaded files.
 * @param inputs - Listed items, live items, Drivers and selections.
 * @returns The fallbacks, and the selections with their icon files.
 */
export async function downloadIconsAsync(
	options: IconWriter,
	{
		items,
		live,
		registry,
		selections,
	}: {
		readonly items: ReadonlyArray<ImportItem>;
		readonly live: ImportLive;
		readonly registry: DriverRegistry;
		readonly selections: ReadonlyArray<ImportSelection>;
	},
): Promise<{
	readonly fallbacks: ReadonlyArray<IconFallback>;
	readonly selections: ReadonlyArray<ImportSelection>;
}> {
	const targets = downloadTargets(selections, items);
	const icons = await downloadAllAsync(options, { live, registry, targets });
	const fallbacks = [...icons.values()]
		.filter(({ source }) => source === "userFile")
		.map(({ cause, item: { key, kind, robloxId }, path }) => {
			return { key, cause, kind, path, robloxId };
		});
	return {
		fallbacks,
		selections: selections.map((selection) => {
			const icon = icons.get(selectionKey(selection));
			return icon === undefined
				? selection
				: { ...selection, icon: { path: icon.path, source: icon.source } };
		}),
	};
}

function selectionKey({ kind, robloxId }: Pick<ImportSelection, "kind" | "robloxId">): string {
	return `${kind}:${robloxId}`;
}

function downloadTargets(
	selections: ReadonlyArray<ImportSelection>,
	items: ReadonlyArray<ImportItem>,
): ReadonlyMap<string, ImportItem> {
	const targets = new Map<string, ImportItem>();
	for (const selection of selections) {
		const item = items.find((one) => selectionKey(one) === selectionKey(selection));
		if (item?.trackedBy === undefined && item?.icon !== undefined) {
			const key = selection.key ?? item.key;
			targets.set(selectionKey(item), {
				...item,
				key,
				icon: { ...item.icon, path: importIconPath(item.kind, key) },
			});
		}
	}

	return targets;
}

async function downloadKindAsync<K extends ImportKind>(
	options: IconWriter,
	{
		driver,
		kind,
		live,
		targets,
	}: {
		readonly driver: ResourceDriver<K>;
		readonly kind: K;
		readonly live: LiveItems<K>;
		readonly targets: ReadonlyMap<string, ImportItem>;
	},
): Promise<ReadonlyArray<readonly [string, DownloadedIcon]>> {
	const icons: Array<readonly [string, DownloadedIcon]> = [];
	for (const [robloxId, state] of live) {
		const key = selectionKey({ kind, robloxId });
		const item = targets.get(key);
		if (item?.icon === undefined) {
			continue;
		}

		const { path } = item.icon;
		const stored = await driver.readIcon?.(state);
		if (stored?.success === true && stored.data !== undefined) {
			await options.writeFile(path, stored.data);
			icons.push([key, { cause: undefined, item, path, source: "download" }]);
		} else {
			const cause = stored?.success === false ? stored.err : undefined;
			icons.push([key, { cause, item, path, source: "userFile" }]);
		}
	}

	return icons;
}

async function downloadAllAsync(
	options: IconWriter,
	{
		live,
		registry,
		targets,
	}: {
		readonly live: ImportLive;
		readonly registry: DriverRegistry;
		readonly targets: ReadonlyMap<string, ImportItem>;
	},
): Promise<ReadonlyMap<string, DownloadedIcon>> {
	return new Map([
		...(await downloadKindAsync(options, {
			driver: registry.badge,
			kind: "badge",
			live: live.badge,
			targets,
		})),
		...(await downloadKindAsync(options, {
			driver: registry.developerProduct,
			kind: "developerProduct",
			live: live.developerProduct,
			targets,
		})),
		...(await downloadKindAsync(options, {
			driver: registry.gamePass,
			kind: "gamePass",
			live: live.gamePass,
			targets,
		})),
	]);
}
