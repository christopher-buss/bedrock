import type { RobloxAssetId } from "../types/ids.ts";
import type { ConfigEdit, EditFields } from "./config-editor/edit-config.ts";
import { collectImports, type ImportKind } from "./import-current.ts";
import { IMPORT_COLLECTIONS } from "./import-kinds.ts";
import type { LiveSnapshot, ResourceLiveState } from "./live-state.ts";
import { resourceRobloxId } from "./live-state.ts";
import { extractDisplayNamePrefix } from "./migrate/extract-display-name-prefix.ts";
import type { Config } from "./schema.ts";
import type { BedrockState } from "./state.ts";

/**
 * One field where a linked live item differs from config.
 *
 * @since unreleased
 */
export interface ImportFieldDifference {
	/**
	 * Value in config. For `icon`, the path of the icon file the import
	 * writes.
	 */
	readonly config: unknown;
	/** Field name. */
	readonly field: string;
	/** Value read from Roblox. For `icon`, the stored icon's asset ID. */
	readonly live: unknown;
}

/**
 * An untracked live item of another Environment that a Key can be linked
 * to.
 *
 * @since unreleased
 */
export interface ImportLinkCandidate {
	/** Name shown on Roblox. */
	readonly name: string;
	/**
	 * Fields where the live item differs from the entry the import writes,
	 * in field order. The next deploy in that Environment applies the
	 * config values.
	 */
	readonly differences: ReadonlyArray<ImportFieldDifference>;
	/** Roblox ID of the item. */
	readonly robloxId: RobloxAssetId;
}

/**
 * How one imported Key can be linked in one other Environment.
 *
 * @since unreleased
 */
export interface ImportLink {
	/** Key the item is written under. */
	readonly key: string;
	/** Untracked live items of the same Kind in that Environment. */
	readonly candidates: ReadonlyArray<ImportLinkCandidate>;
	/** The other Environment. */
	readonly environment: string;
	/** Kind of the item. */
	readonly kind: ImportKind;
	/**
	 * Roblox ID the selection links to, or `undefined` when it is left
	 * unlinked; the next deploy in that Environment then creates the item.
	 */
	readonly linked: RobloxAssetId | undefined;
	/** Roblox ID of the item in the source Environment. */
	readonly robloxId: RobloxAssetId;
	/**
	 * The one candidate with the same name after the display-name prefix is
	 * removed, or `undefined` when there is none or more than one.
	 */
	readonly suggested: RobloxAssetId | undefined;
}

/** What the link computation reads from the plan input. */
export interface LinkSources {
	/** The project config, as authored. */
	readonly config: Config;
	/** The source Environment. */
	readonly environment: string;
	/** Live lists of the other Environments, by name. */
	readonly linkLive?: Readonly<Record<string, LiveSnapshot>>;
	/** Saved State per Environment. */
	readonly states?: Readonly<Record<string, BedrockState | undefined>>;
}

/** The source item a link is made for. */
export interface LinkSubject {
	/** Key the item is written under. */
	readonly key: string;
	/** Name shown on Roblox. */
	readonly name: string;
	/** Fields of the root entry the import writes. */
	readonly fields: EditFields;
	/** Asset ID of the source item's stored icon. */
	readonly iconId: RobloxAssetId | undefined;
	/** Kind of the item. */
	readonly kind: ImportKind;
	/** Linked Roblox ID per Environment, as selected. */
	readonly links: Readonly<Record<string, RobloxAssetId>> | undefined;
	/** Roblox ID of the item in the source Environment. */
	readonly robloxId: RobloxAssetId;
}

type ImportLive = ResourceLiveState<ImportKind>;

const fieldOrder = new Intl.Collator();

/**
 * Roblox IDs of one Kind that an Environment already tracks, with the Key
 * that tracks each: held in that Environment's State or named by an
 * `importId` line of its overlay.
 *
 * @param sources - Config and State per Environment.
 * @param where - Environment to look in and Kind to look up.
 * @returns The tracking Key per Roblox ID.
 */
export function trackingKeys(
	sources: LinkSources,
	{ environment, kind }: { readonly environment: string; readonly kind: ImportKind },
): Map<RobloxAssetId, string> {
	const tracking = new Map<RobloxAssetId, string>();
	const resources = sources.states?.[environment]?.resources ?? [];
	for (const resource of resources) {
		const robloxId = resource.kind === kind ? resourceRobloxId(resource) : undefined;
		if (robloxId !== undefined) {
			tracking.set(robloxId, resource.key);
		}
	}

	const declarations = collectImports(sources.config, environment);
	for (const declaration of declarations) {
		if (declaration.kind === kind) {
			tracking.set(declaration.robloxId, declaration.key);
		}
	}

	return tracking;
}

/**
 * The other Environments whose live lists were read, in config order.
 *
 * @param sources - Config, source Environment and live lists.
 * @returns The names of the Environments to link in.
 */
export function linkEnvironments(sources: LinkSources): ReadonlyArray<string> {
	return Object.keys(sources.config.environments).filter((environment) => {
		return environment !== sources.environment && sources.linkLive?.[environment] !== undefined;
	});
}

function nameBody(name: string): string {
	return extractDisplayNamePrefix(name).body;
}

/** Fields compared on a link, with the value an absent field means. */
const COMPARED: Readonly<Record<ImportKind, Readonly<Record<string, unknown>>>> = {
	badge: { name: undefined, description: undefined, enabled: true },
	developerProduct: {
		name: undefined,
		description: undefined,
		isManagedPricingEnabled: false,
		price: undefined,
	},
	gamePass: {
		name: undefined,
		description: undefined,
		isManagedPricingEnabled: false,
		price: undefined,
	},
};

/** A selected link that cannot be written. */
export interface LinkProblem {
	/** Environment of the link. */
	readonly environment: string;
	/**
	 * `claimed`: an earlier selection links to the same item. `notCandidate`:
	 * the item is not an untracked live item of the Kind there.
	 */
	readonly problem: "claimed" | "notCandidate";
	/** Roblox ID the selection links to. */
	readonly robloxId: RobloxAssetId;
}

/**
 * The links of the accepted selections of one plan. A live item of another
 * Environment can be linked by one Key only.
 */
export interface Linker {
	/**
	 * Find the first selected link that cannot be written.
	 *
	 * @param selection - Kind and selected links of the item.
	 * @returns The problem, or `undefined` when every link can be written.
	 */
	check(selection: {
		readonly kind: ImportKind;
		readonly links?: LinkSubject["links"];
	}): LinkProblem | undefined;
	/**
	 * Record the links of an accepted selection.
	 *
	 * @param subject - The item, its Key, its entry and the selected links.
	 * @returns The `importId` lines of its linked Environments.
	 */
	link(subject: LinkSubject): ReadonlyArray<ConfigEdit>;
	/**
	 * Every recorded link, grouped by Environment in config order, then in
	 * the order they were recorded.
	 *
	 * @returns The links.
	 */
	links(): ReadonlyArray<ImportLink>;
}

/** A live item of another Environment that a selection links to. */
interface LinkTarget {
	/** The other Environment. */
	readonly environment: string;
	/** Kind of the item. */
	readonly kind: ImportKind;
	/** Roblox ID of the item. */
	readonly robloxId: RobloxAssetId;
}

/**
 * Asset ID of the stored icon of a live item.
 *
 * @param live - Live state of the item.
 * @returns The asset ID, or `undefined` for the Roblox default image.
 */
export function storedIcon(live: ImportLive): RobloxAssetId | undefined {
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

/**
 * The links of one imported item in every other Environment.
 *
 * @param sources - Config, State and live lists.
 * @param subject - The item, its Key and the selected links.
 * @returns One link per other Environment, in config order.
 */
export function linksFor(sources: LinkSources, subject: LinkSubject): ReadonlyArray<ImportLink> {
	return linkEnvironments(sources).map((environment) => {
		const candidates = liveCandidates(sources, { environment, kind: subject.kind }).map(
			([robloxId, live]) => {
				return {
					name: live.name ?? "",
					differences: differencesOf(subject, live),
					robloxId,
				};
			},
		);
		const body = nameBody(subject.name);
		const matches = candidates.filter(({ name }) => nameBody(name) === body);
		return {
			key: subject.key,
			candidates,
			environment,
			kind: subject.kind,
			linked: subject.links?.[environment],
			robloxId: subject.robloxId,
			suggested: matches.length === 1 ? matches[0]?.robloxId : undefined,
		};
	});
}

/**
 * Start the links of one plan.
 *
 * @param sources - Config, State and live lists.
 * @returns A {@link Linker} with no links recorded.
 */
export function createLinker(sources: LinkSources): Linker {
	const claimed = new Set<string>();
	const recorded: Array<ImportLink> = [];
	return {
		check: (selection) => firstLinkProblem(sources, { ...selection, claimed }),
		link: (subject) => {
			const links = linksFor(sources, subject);
			recorded.push(...links);
			for (const link of links) {
				if (link.linked !== undefined) {
					claimed.add(claimKey({ ...link, robloxId: link.linked }));
				}
			}

			return links.flatMap(linkEdit);
		},
		links: () => {
			return linkEnvironments(sources).flatMap((environment) => {
				return recorded.filter((link) => link.environment === environment);
			});
		},
	};
}

/**
 * Whether an item exists only in the source Environment: every other
 * Environment's list of its Kind was read, and none holds an untracked item
 * of the same name or one that no source item's name matches.
 *
 * @param sources - Config, State and live lists.
 * @param item - Kind and name of the item, and the names of every source
 *   item of the Kind.
 * @returns `true` when no other Environment has an item to link it to.
 */
export function onlyInSource(
	sources: LinkSources,
	{
		name,
		kind,
		sourceNames,
	}: {
		readonly kind: ImportKind;
		readonly name: string;
		readonly sourceNames: ReadonlyArray<string>;
	},
): boolean {
	const environments = linkEnvironments(sources);
	if (environments.length === 0) {
		return false;
	}

	const linkable = linkableBy(nameBody(name), new Set(sourceNames.map(nameBody)));
	return environments.every((environment) => {
		const listed = sources.linkLive?.[environment]?.[kind];
		return (
			listed !== undefined && !liveCandidates(sources, { environment, kind }).some(linkable)
		);
	});
}

function iconDifference(
	subject: LinkSubject,
	live: ImportLive,
): ReadonlyArray<ImportFieldDifference> {
	const { icon } = subject.fields;
	const stored = storedIcon(live);
	return typeof icon !== "object" || stored === subject.iconId
		? []
		: [{ config: icon["en-us"], field: "icon", live: stored }];
}

function differencesOf(
	subject: LinkSubject,
	live: ImportLive,
): ReadonlyArray<ImportFieldDifference> {
	const values: ReadonlyMap<string, unknown> = new Map(Object.entries(live));
	const fields = Object.entries(COMPARED[subject.kind]).flatMap(([field, absent]) => {
		const config = subject.fields[field] ?? absent;
		const observed = values.get(field);
		return config !== observed && values.has(field) ? [{ config, field, live: observed }] : [];
	});
	return [...iconDifference(subject, live), ...fields].toSorted((left, right) => {
		return fieldOrder.compare(left.field, right.field);
	});
}

function liveCandidates(
	sources: LinkSources,
	{ environment, kind }: { readonly environment: string; readonly kind: ImportKind },
): ReadonlyArray<readonly [RobloxAssetId, ImportLive]> {
	const live: ReadonlyMap<RobloxAssetId, ImportLive> | undefined =
		sources.linkLive?.[environment]?.[kind];
	const tracked = trackingKeys(sources, { environment, kind });
	return [...(live ?? [])].filter(([robloxId]) => !tracked.has(robloxId));
}

function claimKey({ environment, kind, robloxId }: LinkTarget): string {
	return `${environment}:${kind}:${robloxId}`;
}

function firstLinkProblem(
	sources: LinkSources,
	{
		claimed,
		kind,
		links,
	}: {
		readonly claimed: ReadonlySet<string>;
		readonly kind: ImportKind;
		readonly links?: LinkSubject["links"];
	},
): LinkProblem | undefined {
	const environments = linkEnvironments(sources);
	const selected = Object.entries(links ?? {});
	for (const [environment, robloxId] of selected) {
		const listed =
			environments.includes(environment) &&
			liveCandidates(sources, { environment, kind }).some(([candidate]) => {
				return candidate === robloxId;
			});
		if (!listed) {
			return { environment, problem: "notCandidate", robloxId };
		}

		if (claimed.has(claimKey({ environment, kind, robloxId }))) {
			return { environment, problem: "claimed", robloxId };
		}
	}

	return undefined;
}

function linkEdit({ key, environment, kind, linked }: ImportLink): ReadonlyArray<ConfigEdit> {
	return linked === undefined
		? []
		: [
				{
					key,
					collection: IMPORT_COLLECTIONS[kind],
					environment,
					importId: linked,
					kind: "declareImport",
				},
			];
}

function linkableBy(
	body: string,
	matched: ReadonlySet<string>,
): (candidate: readonly [RobloxAssetId, ImportLive]) => boolean {
	return ([, live]) => {
		const candidate = nameBody(live.name ?? "");
		return candidate === body || !matched.has(candidate);
	};
}
