import { asResourceKey, asRobloxAssetId, asSha256Hex, isSha256Hex } from "../../types/ids.ts";
import type { ResourceKey, Sha256Hex } from "../../types/ids.ts";
import type { BadgeOutputs } from "../resources.ts";
import type { BadgeEntry } from "../schema.ts";
import { coerceRobloxId, isObjectPayload } from "./fold-universe-shared.ts";
import type { MigrationWarning } from "./migration-report.ts";
import type { MantleResource } from "./types.ts";

const BADGE_KIND = "badge";
const BADGE_ICON_KIND = "badgeIcon";

/**
 * Folded representation of one Mantle `badge_<k>` resource.
 *
 * `entry` carries the bedrock `Config.badges[<k>]` shape. `outputs` carries
 * the Roblox-assigned badge id and the current icon image id: the matching
 * `badgeIcon_<k>` asset when present, else Mantle's `initialIconAssetId`.
 * `mantleIconFileHashes` preserves the hash recorded on the `badgeIcon_<k>`
 * partner so the shell can fall back to it when the icon file is missing on
 * disk; absent when no well-formed partner is found.
 */
export interface BadgeFoldEntry {
	/** User-supplied Mantle key, branded as a bedrock `ResourceKey`. */
	readonly key: ResourceKey;
	/** Bedrock `Config.badges[<k>]` block populated from the badge resource. */
	readonly entry: BadgeEntry & { enabled: boolean };
	/**
	 * Locale-keyed Mantle-recorded icon hashes; absent when no badgeIcon
	 * partner is paired.
	 */
	readonly mantleIconFileHashes?: Record<"en-us", Sha256Hex>;
	/** Resource-rooted Mantle path (`badge_<k>`) used to anchor warnings. */
	readonly mantlePath: string;
	/**
	 * Roblox-assigned identifiers carried into
	 * `BedrockState.resources[*].outputs`.
	 */
	readonly outputs: BadgeOutputs;
}

/**
 * Output of folding the `badge_<k>` and `badgeIcon_<k>` Mantle resources of
 * one environment into bedrock-shaped badge entries.
 */
interface BadgesFoldResult {
	/** One folded entry per well-formed Mantle `badge_<k>` resource. */
	readonly badges: ReadonlyArray<BadgeFoldEntry>;
	/** Orphan badgeIcon resources surface as `ambiguous` warnings. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

interface BadgeIconParts {
	readonly assetId: string;
	readonly fileHash: Sha256Hex;
}

/**
 * Fold the `badge_<k>` (and matching `badgeIcon_<k>`) Mantle resources of
 * one environment into bedrock badge entries plus matching outputs.
 *
 * A null or absent Mantle `description` folds to `""`. Resources whose
 * payload is malformed (non-object, missing `name` / `enabled` /
 * `iconFilePath`, missing `assetId`, no icon image id) are dropped silently.
 * A malformed `badgeIcon_<k>` partner is ignored. Orphan `badgeIcon_<k>`
 * resources (no matching badge) emit one `ambiguous` warning each.
 *
 * @param resources - Resource list for one Mantle environment.
 * @returns The folded badge entries plus per-rule diagnostics.
 */
export function foldBadges(resources: ReadonlyArray<MantleResource>): BadgesFoldResult {
	const badges = resources.filter((resource) => resource.kind === BADGE_KIND);
	const icons = new Map(
		resources
			.filter((resource) => resource.kind === BADGE_ICON_KIND)
			.map((resource) => [resource.key, resource]),
	);

	const folded = badges.flatMap((resource): ReadonlyArray<BadgeFoldEntry> => {
		const iconResource = icons.get(resource.key);
		const iconParts = iconResource === undefined ? undefined : readIconParts(iconResource);
		const entry = foldOneBadge(resource, iconParts);
		return entry === undefined ? [] : [entry];
	});

	const badgeKeys = new Set(badges.map((resource) => resource.key));
	const warnings = [...icons.keys()]
		.filter((key) => !badgeKeys.has(key))
		.map((key) => orphanIconWarning(key));

	return { badges: folded, warnings };
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readIconParts(resource: MantleResource): BadgeIconParts | undefined {
	if (!isObjectPayload(resource.inputs) || !isObjectPayload(resource.outputs)) {
		return undefined;
	}

	const fileHash = readString(resource.inputs["fileHash"]);
	const assetId = coerceRobloxId(resource.outputs["assetId"]);
	if (assetId === undefined || fileHash === undefined || !isSha256Hex(fileHash)) {
		return undefined;
	}

	return { assetId, fileHash: asSha256Hex(fileHash) };
}

function readDescription(value: unknown): string | undefined {
	if (value === undefined || value === null) {
		return "";
	}

	return readString(value);
}

function readEntry(raw: unknown): (BadgeEntry & { enabled: boolean }) | undefined {
	if (!isObjectPayload(raw)) {
		return undefined;
	}

	const name = readString(raw["name"]);
	const description = readDescription(raw["description"]);
	const { enabled } = raw;
	const iconFilePath = readString(raw["iconFilePath"]);
	if (
		typeof enabled !== "boolean" ||
		name === undefined ||
		description === undefined ||
		iconFilePath === undefined
	) {
		return undefined;
	}

	return { name, description, enabled, icon: { "en-us": iconFilePath } };
}

function readOutputs(
	raw: unknown,
	iconParts: BadgeIconParts | undefined,
): BadgeOutputs | undefined {
	if (!isObjectPayload(raw)) {
		return undefined;
	}

	const badgeId = coerceRobloxId(raw["assetId"]);
	const iconImageId = iconParts?.assetId ?? coerceRobloxId(raw["initialIconAssetId"]);
	if (badgeId === undefined || iconImageId === undefined) {
		return undefined;
	}

	return { badgeId: asRobloxAssetId(badgeId), iconImageId: asRobloxAssetId(iconImageId) };
}

function foldOneBadge(
	resource: MantleResource,
	iconParts: BadgeIconParts | undefined,
): BadgeFoldEntry | undefined {
	const entry = readEntry(resource.inputs);
	const outputs = readOutputs(resource.outputs, iconParts);
	if (entry === undefined || outputs === undefined) {
		return undefined;
	}

	const base: BadgeFoldEntry = {
		key: asResourceKey(resource.key),
		entry,
		mantlePath: `${BADGE_KIND}_${resource.key}`,
		outputs,
	};

	return iconParts === undefined
		? base
		: { ...base, mantleIconFileHashes: { "en-us": iconParts.fileHash } };
}

function orphanIconWarning(key: string): MigrationWarning {
	return {
		hint: "Verify your Mantle state file: each badgeIcon_<k> resource must be paired with a matching badge_<k>.",
		kind: "ambiguous",
		mantlePath: `${BADGE_ICON_KIND}_${key}`,
	};
}
