import type { Result } from "@bedrock-rbx/ocale";

import { type } from "arktype";

import type { BadgeDesiredInput } from "../flatten.ts";
import { hashIconLocalesAsync, iconHashesEqual, iconMap } from "../icons.ts";
import type { BadgeDesiredState, ResourceCurrentState } from "../resources.ts";
import { BADGE_RETIREMENT_UNAVAILABLE } from "../retirement-refusals.ts";
import type { ResolvedConfig } from "../schema.ts";
import { type FlattenedEntry, flattenEntries } from "./flatten-entries.ts";
import type { BuildDesiredError, KindIo, ResourceKindModule } from "./module.ts";

const entrySchema = type({
	"name": "string",
	"description": "string",
	"enabled?": "boolean",
	"icon": iconMap,
});

function flatten(
	config: ResolvedConfig,
): ReadonlyArray<FlattenedEntry<BadgeDesiredInput, "badge">> {
	return flattenEntries(config.badges, {
		kind: "badge",
		toLive: (key, entry): BadgeDesiredInput => {
			return {
				key,
				name: entry.name,
				description: entry.description,
				enabled: entry.enabled ?? true,
				icon: entry.icon,
				kind: "badge",
			};
		},
	});
}

async function normalizeAsync(
	input: BadgeDesiredInput,
	io: KindIo,
): Promise<Result<BadgeDesiredState, BuildDesiredError>> {
	const hashes = await hashIconLocalesAsync({ key: input.key, icon: input.icon }, io);
	if (!hashes.success) {
		return hashes;
	}

	return {
		data: {
			key: input.key,
			name: input.name,
			description: input.description,
			enabled: input.enabled,
			icon: input.icon,
			iconFileHashes: hashes.data,
			kind: "badge",
		},
		success: true,
	};
}

function changedFieldsBetween(
	desired: BadgeDesiredState,
	current: ResourceCurrentState<"badge">,
): ReadonlyArray<string> {
	return [
		...(desired.description === current.description ? [] : ["description"]),
		...(desired.enabled === current.enabled ? [] : ["enabled"]),
		...(desired.icon["en-us"] === current.icon["en-us"] ? [] : ["icon"]),
		...(iconHashesEqual(current.iconFileHashes, desired.iconFileHashes)
			? []
			: ["iconFileHashes"]),
		...(desired.name === current.name ? [] : ["name"]),
	];
}

/**
 * Resource-kind module for Roblox badges. Owns the entry schema,
 * flattening, icon-hash normalization, and drift-equality for the `badge`
 * kind. Retirement is refused.
 */
export const badgeKind: ResourceKindModule<"badge"> = {
	assertRetirable(key) {
		return {
			err: { key, kind: "retirementRejected", message: BADGE_RETIREMENT_UNAVAILABLE },
			success: false,
		};
	},
	changedFieldsBetween,
	entrySchema,
	fieldsEqual(desired, current) {
		return changedFieldsBetween(desired, current).length === 0;
	},
	flatten,
	kind: "badge",
	normalize: normalizeAsync,
};
