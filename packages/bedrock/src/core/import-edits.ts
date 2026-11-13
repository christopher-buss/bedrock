import type { ConfigEdit, EditFields } from "./config-editor/edit-config.ts";
import { importIconPath } from "./import-key.ts";
import { IMPORT_COLLECTIONS as COLLECTIONS } from "./import-kinds.ts";
import type { Linker } from "./import-links.ts";
import { environmentPrefix, placeEntryFields } from "./import-places.ts";
import type {
	ImportIcon,
	ImportItem,
	ImportItemKind,
	ImportPlanInput,
	ImportSelection,
	ImportTarget,
} from "./import-plan-types.ts";
import type { ResourceLiveState } from "./live-state.ts";

/** A selection that passed every check, with the Key it is written under. */
export interface SelectedItem {
	/** Key the entry is written under. */
	readonly key: string;
	/** The listed item. */
	readonly item: ImportItem;
	/** Live state of the item. */
	readonly live: ImportLive;
	/** The selection as given. */
	readonly selection: ImportSelection;
}

type ImportLive = ResourceLiveState<ImportItemKind>;

/**
 * Config edits of an accepted selection: its root entry, the source
 * Environment's `importId` or `placeId` line, and the lines of its links.
 *
 * @param input - Config and source Environment.
 * @param accepted - The selection and the links of the plan.
 * @returns The edits, in write order.
 */
export function acceptedEdits(
	{ config, environment }: ImportPlanInput,
	{ checked, linker }: { readonly checked: SelectedItem; readonly linker: Linker },
): ReadonlyArray<ConfigEdit> {
	const entry = plannedEntry(checked, environmentPrefix(config, environment));
	const { key, item, selection } = checked;
	return [
		...editsFor(environment, { ...checked, ...entry }),
		...linker.link({
			...selection,
			key,
			name: item.name,
			fields: entry.fields,
			iconId: item.icon?.assetId,
			links: selection.links,
		}),
	];
}

/**
 * `retired: "untrack"` edits for the tracked items to stop tracking.
 *
 * @param items - Every listed item.
 * @param targets - Items to stop tracking; untracked ones are skipped.
 * @returns One edit per tracked target.
 */
export function untrackEdits(
	items: ReadonlyArray<ImportItem>,
	targets: ReadonlyArray<ImportTarget>,
): ReadonlyArray<ConfigEdit> {
	return targets.flatMap(({ kind, robloxId }) => {
		const key = items.find(
			(item) => item.kind === kind && item.robloxId === robloxId,
		)?.trackedBy;
		return key === undefined ? [] : [{ key, collection: COLLECTIONS[kind], kind: "untrack" }];
	});
}

function entryFields(
	{
		name,
		live,
		prefix,
	}: { readonly live: ImportLive; readonly name: string; readonly prefix: string },
	icon: ImportIcon | undefined,
): EditFields {
	if (live.kind === "place") {
		return placeEntryFields(live, prefix);
	}

	const named = { name, description: live.description ?? "" };
	const iconField = icon === undefined ? {} : { icon: { "en-us": icon.path } };
	if (live.kind === "badge") {
		return { ...named, ...(live.enabled === false ? { enabled: false } : {}), ...iconField };
	}

	return {
		...named,
		...iconField,
		...(live.isManagedPricingEnabled === true ? { isManagedPricingEnabled: true } : {}),
		...(live.price === undefined ? {} : { price: live.price }),
	};
}

function plannedEntry(
	{ key, item, live, selection }: SelectedItem,
	prefix: string,
): {
	readonly fields: EditFields;
	readonly icon: ImportIcon | undefined;
} {
	const icon =
		item.icon === undefined
			? undefined
			: (selection.icon ?? { path: importIconPath(selection.kind, key), source: "download" });
	return { fields: entryFields({ name: item.name, live, prefix }, icon), icon };
}

function editsFor(
	environment: string,
	{
		key,
		fields,
		icon,
		selection,
	}: SelectedItem & { readonly fields: EditFields; readonly icon: ImportIcon | undefined },
): ReadonlyArray<ConfigEdit> {
	const collection = COLLECTIONS[selection.kind];
	const entry: ConfigEdit = { key, collection, entry: fields, kind: "addEntry" };
	if (selection.kind === "place") {
		return [entry, { key, environment, kind: "declarePlaceId", placeId: selection.robloxId }];
	}

	return [
		entry,
		{
			key,
			collection,
			environment,
			...(icon?.source === "userFile" ? { iconBaseline: "accept-local-file" } : {}),
			importId: selection.robloxId,
			kind: "declareImport",
		},
	];
}
