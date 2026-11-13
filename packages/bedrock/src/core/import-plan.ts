import { isResourceKey, type RobloxAssetId } from "../types/ids.ts";
import type { ConfigEdit, EditFields } from "./config-editor/edit-config.ts";
import type { ImportKind } from "./import-current.ts";
import { importIconPath, suggestImportKey, takenKeys } from "./import-key.ts";
import {
	IMPORT_COLLECTIONS as COLLECTIONS,
	IMPORT_KIND_NAMES,
	IMPORT_KINDS,
} from "./import-kinds.ts";
import {
	createLinker,
	type Linker,
	onlyInSource,
	storedIcon,
	trackingKeys,
} from "./import-links.ts";
import type {
	ImportIcon,
	ImportItem,
	ImportPlan,
	ImportPlanInput,
	ImportRefusal,
	ImportRefusalReason,
	ImportSelection,
	ImportTarget,
} from "./import-plan-types.ts";
import { hasPlaceholderName, redactionMark } from "./import-redaction.ts";
import type { ResourceLiveState } from "./live-state.ts";

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
	const linker = createLinker(input);
	const edits: Array<ConfigEdit> = [];
	const refused: Array<ImportRefusal> = [];
	const selections = input.selections ?? [];
	for (const selection of selections) {
		const checked = checkSelection(input, {
			found: listed.find(({ item: { kind, robloxId } }) => {
				return kind === selection.kind && robloxId === selection.robloxId;
			}),
			linker,
			selection,
			taken: taken[selection.kind],
		});
		if ("reason" in checked) {
			refused.push(checked);
		} else {
			edits.push(...acceptedEdits(input.environment, { checked, linker }));
		}
	}

	const items = listed.map(({ item }) => item);
	const untrack = untrackEdits(items, input.untrack ?? []);
	return { edits: [...edits, ...untrack], items, links: linker.links(), refused };
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

function plannedEntry({ key, item, live, selection }: SelectedItem): {
	readonly fields: EditFields;
	readonly icon: ImportIcon | undefined;
} {
	const icon =
		item.icon === undefined
			? undefined
			: (selection.icon ?? { path: importIconPath(selection.kind, key), source: "download" });
	return { fields: entryFields({ name: item.name, live }, icon), icon };
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
	return [
		{ key, collection, entry: fields, kind: "addEntry" },
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

function acceptedEdits(
	environment: string,
	{ checked, linker }: { readonly checked: SelectedItem; readonly linker: Linker },
): ReadonlyArray<ConfigEdit> {
	const entry = plannedEntry(checked);
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

function checkItem(
	input: ImportPlanInput,
	{ found, selection }: { readonly found: LiveItem; readonly selection: ImportSelection },
): ImportRefusal | undefined {
	const { item } = found;
	const named = { ...selection, name: item.name };
	if (item.trackedBy !== undefined) {
		return refusal({
			reason: "tracked",
			selection: named,
			text: `is already tracked by '${item.trackedBy}'.`,
		});
	}

	if (item.unavailable !== undefined) {
		return item.unavailable;
	}

	if (hasPlaceholderName(input.config, { ...item, environment: input.environment })) {
		return refusal({
			reason: "placeholder",
			selection: named,
			text: `has the redaction placeholder of "${input.environment}" as its name. Give it its real name on Roblox, then import it.`,
		});
	}

	return selection.kind !== "developerProduct" && item.icon === undefined
		? refusal({
				reason: "defaultImage",
				selection: named,
				text: "uses the Roblox default image. Give it an icon on Roblox, then import it.",
			})
		: undefined;
}

function checkLink(
	linker: Linker,
	selection: ImportSelection & { readonly name: string },
): ImportRefusal | undefined {
	const link = linker.check(selection);
	if (link === undefined) {
		return undefined;
	}

	const why =
		link.problem === "claimed"
			? "another Key links to it."
			: `it is not an untracked live ${IMPORT_KIND_NAMES[selection.kind]} there.`;
	return refusal({
		reason: "linkUnavailable",
		selection,
		text: `cannot link to id ${link.robloxId} in "${link.environment}": ${why}`,
	});
}

function checkSelection(
	input: ImportPlanInput,
	{
		found,
		linker,
		selection,
		taken,
	}: {
		readonly found: LiveItem | undefined;
		readonly linker: Linker;
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
	const key = selection.key ?? item.key;
	return (
		checkItem(input, { found, selection }) ??
		checkLink(linker, named) ??
		checkKey(named, { key, taken }) ?? { key, item, live, selection }
	);
}

function onlyHereRefusal(
	input: ImportPlanInput,
	item: Pick<ImportItem, "kind" | "name" | "robloxId">,
): ImportRefusal {
	return refusal({
		reason: "onlyOneEnvironment",
		selection: item,
		text: `exists only in "${input.environment}": no other Environment has a live ${IMPORT_KIND_NAMES[item.kind]} to link it to, so it cannot be imported yet.`,
	});
}

function itemsOf(input: ImportPlanInput, kind: ImportKind): ReadonlyArray<LiveItem> {
	const live: ReadonlyMap<RobloxAssetId, ImportLive> | undefined = input.live[kind];
	const tracking = trackingKeys(input, { environment: input.environment, kind });
	const taken = takenKeys(input, kind);
	const entries = [...(live ?? new Map<RobloxAssetId, ImportLive>())];
	const names = entries.map(([, liveItem]) => liveItem.name ?? "");
	const redacted = redactionMark(input.config, input.environment);
	return entries.map(([robloxId, liveItem]) => {
		const name = liveItem.name ?? "";
		const trackedBy = tracking.get(robloxId);
		const key = trackedBy ?? suggestImportKey({ name, kind, robloxId }, taken);
		taken.add(key);
		const assetId = storedIcon(liveItem);
		const icon =
			assetId === undefined ? undefined : { assetId, path: importIconPath(kind, key) };
		const item = { key, name, icon, kind, robloxId, ...redacted, trackedBy };
		return {
			item:
				trackedBy === undefined && onlyInSource(input, { ...item, sourceNames: names })
					? { ...item, unavailable: onlyHereRefusal(input, item) }
					: item,
			live: liveItem,
		};
	});
}
