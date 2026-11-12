import { isResourceKey, type RobloxAssetId } from "../types/ids.ts";
import type { ConfigEdit, EditFields } from "./config-editor/edit-config.ts";
import { collectImports, type ImportKind } from "./import-current.ts";
import {
	IMPORT_COLLECTIONS as COLLECTIONS,
	importIconPath,
	suggestImportKey,
} from "./import-key.ts";
import { IMPORT_KIND_NAMES, IMPORT_KINDS } from "./import-kinds.ts";
import { type LiveSnapshot, type ResourceLiveState, resourceRobloxId } from "./live-state.ts";
import type { Config } from "./schema.ts";
import type { BedrockState } from "./state.ts";

/**
 * Where the icon file of a selected item comes from.
 *
 * - `download`: the stored icon, downloaded to `path`.
 * - `userFile`: a file the user supplies at `path`. The import then declares
 *   `iconBaseline: "accept-local-file"`, because the file is the user's
 *   claim, not a verified copy.
 *
 * @since unreleased
 */
export interface ImportIcon {
	/** Repository path of the icon file. */
	readonly path: string;
	/** Who made the file. */
	readonly source: "download" | "userFile";
}

/**
 * One live item to import.
 *
 * @since unreleased
 */
export interface ImportSelection {
	/** Key to write instead of the suggested one. */
	readonly key?: string;
	/**
	 * The item's icon file. Defaults to the stored icon downloaded to
	 * `assets/<collection>/<key>.png`.
	 */
	readonly icon?: ImportIcon;
	/** Kind of the item. */
	readonly kind: ImportKind;
	/** Roblox ID of the item. */
	readonly robloxId: RobloxAssetId;
}

/**
 * One live item, named by Kind and Roblox ID.
 *
 * @since unreleased
 */
export interface ImportTarget {
	/** Kind of the item. */
	readonly kind: ImportKind;
	/** Roblox ID of the item. */
	readonly robloxId: RobloxAssetId;
}

/**
 * Input to {@link planImport}.
 *
 * @since unreleased
 */
export interface ImportPlanInput {
	/** The project config, as authored. */
	readonly config: Config;
	/** The Environment whose live items are imported. */
	readonly environment: string;
	/** Live lists of the source Environment's universe. */
	readonly live: LiveSnapshot;
	/** The items to import. */
	readonly selections?: ReadonlyArray<ImportSelection>;
	/**
	 * Saved State per Environment. A missing Environment counts as holding
	 * no State.
	 */
	readonly states?: Readonly<Record<string, BedrockState | undefined>>;
	/**
	 * Tracked items to stop tracking. Each writes `retired: "untrack"` on the
	 * root entry of the Key that tracks it; an item no Key tracks is skipped.
	 */
	readonly untrack?: ReadonlyArray<ImportTarget>;
}

/**
 * The stored icon of a live item, and where to download it.
 *
 * @since unreleased
 */
export interface ImportItemIcon {
	/** Roblox asset ID of the stored icon. */
	readonly assetId: RobloxAssetId;
	/** Suggested repository path for the downloaded file. */
	readonly path: string;
}

/**
 * Why a selected item cannot be imported.
 *
 * @since unreleased
 */
export type ImportRefusalReason =
	| "defaultImage"
	| "invalidKey"
	| "keyTaken"
	| "notLive"
	| "tracked";

/**
 * A selected item that cannot be imported.
 *
 * @since unreleased
 */
export interface ImportRefusal {
	/** Kind of the selection. */
	readonly kind: ImportKind;
	/** What to tell the user. */
	readonly message: string;
	/** Why the item cannot be imported. */
	readonly reason: ImportRefusalReason;
	/** Roblox ID of the selection. */
	readonly robloxId: RobloxAssetId;
}

/**
 * One live item of the source Environment.
 *
 * @since unreleased
 */
export interface ImportItem {
	/** Suggested Key, or the Key that tracks the item. */
	readonly key: string;
	/** Name shown on Roblox. */
	readonly name: string;
	/**
	 * The stored icon, or `undefined` when the item uses the Roblox default
	 * image.
	 */
	readonly icon: ImportItemIcon | undefined;
	/** Kind of the item. */
	readonly kind: ImportKind;
	/** Roblox ID of the item. */
	readonly robloxId: RobloxAssetId;
	/** Key that already tracks the item in the source Environment. */
	readonly trackedBy: string | undefined;
}

/**
 * What {@link planImport} found.
 *
 * @since unreleased
 */
export interface ImportPlan {
	/** Config changes for the importable selections, in selection order. */
	readonly edits: ReadonlyArray<ConfigEdit>;
	/** Every live item, in Kind order: game passes, products, badges. */
	readonly items: ReadonlyArray<ImportItem>;
	/** Selections that cannot be imported, in selection order. */
	readonly refused: ReadonlyArray<ImportRefusal>;
}

type ImportLive = ResourceLiveState<ImportKind>;

/** A listed item with the Live state it was made from. */
interface LiveItem {
	readonly item: ImportItem;
	readonly live: ImportLive;
}

/** A selection that passed every check, with the Key it is written under. */
interface SelectedItem {
	readonly key: string;
	readonly item: ImportItem;
	readonly live: ImportLive;
	readonly selection: ImportSelection;
}

/**
 * Plan an import of live items from one Environment into config. Lists every
 * live item with a suggested Key (the name without its display-name prefix,
 * kebab-cased, suffixed `-2`, `-3` on collision) and the Key that already
 * tracks it, if any. Each selection becomes a root entry with the live
 * values and an `importId` line on the Environment overlay; the next deploy
 * records the item as Current state instead of creating it. Selections that
 * cannot be imported are refused with a message. Nothing is read or written:
 * the caller downloads icons and applies the edits.
 *
 * @since unreleased
 *
 * @example
 * ```ts
 * import { asRobloxAssetId, planImport } from "@bedrock-rbx/core";
 *
 * const id = asRobloxAssetId("11");
 * const plan = planImport({
 *     config: { environments: { production: {} }, universe: { universeId: "1"
 *     } }, environment: "production", live: {
 *         gamePass: new Map([[id, {
 *             name: "[PROD] VIP Pass", description: "Perks.", kind:
 *             "gamePass", outputs: { iconAssetIds: { "en-us":
 *             asRobloxAssetId("555") } }, price: 100,
 *         }]]),
 *     },
 *     selections: [{ kind: "gamePass", robloxId: id }],
 * });
 *
 * expect(plan.items[0]?.key).toBe("vip-pass");
 * expect(plan.items[0]?.icon?.path).toBe("assets/passes/vip-pass.png");
 * expect(plan.edits).toStrictEqual([
 *     {
 *         key: "vip-pass", collection: "passes", kind: "addEntry",
 *         entry: {
 *             name: "[PROD] VIP Pass", description: "Perks.",
 *             icon: { "en-us": "assets/passes/vip-pass.png" }, price: 100,
 *         },
 *     },
 *     {
 *         key: "vip-pass", collection: "passes", kind: "declareImport",
 *         environment: "production", importId: "11",
 *     },
 * ]);
 * ```
 *
 * @param input - Config, source Environment, live items, saved State and
 *   the selections.
 * @returns The live items, the config edits and the refused selections.
 */
export function planImport(input: ImportPlanInput): ImportPlan {
	const listed = IMPORT_KINDS.flatMap((kind) => itemsOf(input, kind));
	const taken: Readonly<Record<ImportKind, Set<string>>> = {
		badge: takenKeys(input, "badge"),
		developerProduct: takenKeys(input, "developerProduct"),
		gamePass: takenKeys(input, "gamePass"),
	};
	const edits: Array<ConfigEdit> = [];
	const refused: Array<ImportRefusal> = [];
	const selections = input.selections ?? [];
	for (const selection of selections) {
		const checked = checkSelection(input, {
			found: listed.find(({ item: { kind, robloxId } }) => {
				return kind === selection.kind && robloxId === selection.robloxId;
			}),
			selection,
			taken: taken[selection.kind],
		});
		if ("reason" in checked) {
			refused.push(checked);
		} else {
			edits.push(...editsFor(input.environment, checked));
		}
	}

	const items = listed.map(({ item }) => item);
	return { edits: [...edits, ...untrackEdits(items, input.untrack ?? [])], items, refused };
}

function untrackEdits(
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

function refusal({
	reason,
	selection: { name, kind, robloxId },
	text,
}: {
	readonly reason: ImportRefusalReason;
	readonly selection: Pick<ImportSelection, "kind" | "robloxId"> & { readonly name?: string };
	readonly text: string;
}): ImportRefusal {
	const label = name === undefined ? "" : ` "${name}"`;
	return { kind, message: `${kind} ${robloxId}${label} ${text}`, reason, robloxId };
}

function checkKey(
	selection: ImportSelection & { readonly name: string },
	{ key, taken }: { readonly key: string; readonly taken: Set<string> },
): ImportRefusal | undefined {
	if (!isResourceKey(key)) {
		return refusal({
			reason: "invalidKey",
			selection,
			text: `cannot use the Key '${key}': use letters, digits, - and _ only.`,
		});
	}

	if (taken.has(key)) {
		return refusal({
			reason: "keyTaken",
			selection,
			text: `cannot use the Key '${key}': it is already in use.`,
		});
	}

	taken.add(key);
	return undefined;
}

function checkSelection(
	input: ImportPlanInput,
	{
		found,
		selection,
		taken,
	}: {
		readonly found: LiveItem | undefined;
		readonly selection: ImportSelection;
		readonly taken: Set<string>;
	},
): ImportRefusal | SelectedItem {
	if (found === undefined) {
		return refusal({
			reason: "notLive",
			selection,
			text: `is not a live ${IMPORT_KIND_NAMES[selection.kind]} in "${input.environment}".`,
		});
	}

	const { item, live } = found;
	const named = { ...selection, name: item.name };
	if (item.trackedBy !== undefined) {
		return refusal({
			reason: "tracked",
			selection: named,
			text: `is already tracked by '${item.trackedBy}'.`,
		});
	}

	if (selection.kind !== "developerProduct" && item.icon === undefined) {
		return refusal({
			reason: "defaultImage",
			selection: named,
			text: "uses the Roblox default image. Give it an icon on Roblox, then import it.",
		});
	}

	const key = selection.key ?? item.key;
	return checkKey(named, { key, taken }) ?? { key, item, live, selection };
}

function entryFields(
	{ name, live }: { readonly live: ImportLive; readonly name: string },
	icon: ImportIcon | undefined,
): EditFields {
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

function editsFor(
	environment: string,
	{ key, item, live, selection }: SelectedItem,
): ReadonlyArray<ConfigEdit> {
	const collection = COLLECTIONS[selection.kind];
	const icon =
		item.icon === undefined
			? undefined
			: (selection.icon ?? { path: importIconPath(selection.kind, key), source: "download" });
	return [
		{ key, collection, entry: entryFields({ name: item.name, live }, icon), kind: "addEntry" },
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

function takenKeys(input: ImportPlanInput, kind: ImportKind): Set<string> {
	const taken = new Set(Object.keys(input.config[COLLECTIONS[kind]] ?? {}));
	const states = Object.values(input.states ?? {});
	for (const state of states) {
		const resources = state?.resources ?? [];
		for (const resource of resources) {
			if (resource.kind === kind) {
				taken.add(resource.key);
			}
		}
	}

	return taken;
}

function storedIcon(live: ImportLive): RobloxAssetId | undefined {
	switch (live.kind) {
		case "badge": {
			return live.outputs.iconImageId;
		}
		case "developerProduct": {
			return live.outputs.iconImageAssetId;
		}
		case "gamePass": {
			return live.outputs.iconAssetIds?.["en-us"];
		}
	}
}

function trackingKeys(input: ImportPlanInput, kind: ImportKind): Map<RobloxAssetId, string> {
	const tracking = new Map<RobloxAssetId, string>();
	const resources = input.states?.[input.environment]?.resources ?? [];
	for (const resource of resources) {
		const robloxId = resource.kind === kind ? resourceRobloxId(resource) : undefined;
		if (robloxId !== undefined) {
			tracking.set(robloxId, resource.key);
		}
	}

	const declarations = collectImports(input.config, input.environment);
	for (const declaration of declarations) {
		if (declaration.kind === kind) {
			tracking.set(declaration.robloxId, declaration.key);
		}
	}

	return tracking;
}

function itemsOf(input: ImportPlanInput, kind: ImportKind): ReadonlyArray<LiveItem> {
	const live: ReadonlyMap<RobloxAssetId, ImportLive> | undefined = input.live[kind];
	const tracking = trackingKeys(input, kind);
	const taken = takenKeys(input, kind);
	return Array.from(live ?? new Map<RobloxAssetId, ImportLive>(), ([robloxId, liveItem]) => {
		const name = liveItem.name ?? "";
		const trackedBy = tracking.get(robloxId);
		const key = trackedBy ?? suggestImportKey({ name, kind, robloxId }, taken);
		taken.add(key);
		const assetId = storedIcon(liveItem);
		const icon =
			assetId === undefined ? undefined : { assetId, path: importIconPath(kind, key) };
		return { item: { key, name, icon, kind, robloxId, trackedBy }, live: liveItem };
	});
}
