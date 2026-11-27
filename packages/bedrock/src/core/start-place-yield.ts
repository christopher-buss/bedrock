import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import type { ResolvedConfig } from "./schema.ts";

/** Place fields the universe also sets on its start place. */
const UNIVERSE_WINS_FIELDS = ["displayName"] as const;

/**
 * A place field the universe sets on its start place in place of the place's
 * own value.
 */
export type StartPlaceField = (typeof UNIVERSE_WINS_FIELDS)[number];

/**
 * A start place field the deploy does not write, because the universe declares
 * it.
 */
export interface StartPlaceFieldSkip {
	/** Config Key of the start place. */
	readonly key: ResourceKey;
	/** The field the universe value wins on. */
	readonly field: StartPlaceField;
}

/**
 * Fields both the universe and at least one place declare. Only these can
 * collide on the start place, so a deploy reads the start place only when
 * this is not empty.
 *
 * @param config - The resolved config of the Environment.
 * @returns Each field the universe and a place both declare.
 */
export function contestedStartPlaceFields(config: ResolvedConfig): ReadonlyArray<StartPlaceField> {
	const places = Object.values(config.places ?? {});
	return UNIVERSE_WINS_FIELDS.filter((field) => {
		return (
			config.universe?.[field] !== undefined &&
			places.some((entry) => entry[field] !== undefined)
		);
	});
}

/**
 * Drop the contested fields from the place that is the universe's start
 * place, so the universe value is the one that goes live. Every other place
 * keeps its own value.
 *
 * @param config - The resolved config of the Environment.
 * @param startPlaceId - Place ID of the universe's live start place.
 * @returns The config to deploy and the fields it skipped.
 */
export function yieldStartPlaceFields(
	config: ResolvedConfig,
	startPlaceId: string,
): { readonly config: ResolvedConfig; readonly skipped: ReadonlyArray<StartPlaceFieldSkip> } {
	const fields = contestedStartPlaceFields(config);
	const entries = Object.entries(config.places ?? {});
	const skipped = entries.flatMap(([key, entry]) => {
		return entry.placeId === startPlaceId
			? fields
					.filter((field) => entry[field] !== undefined)
					.map((field) => ({ key: asResourceKey(key), field }))
			: [];
	});
	const places = Object.fromEntries(
		entries.map(([key, entry]) => {
			return [
				key,
				entry.placeId === startPlaceId
					? { ...entry, ...Object.fromEntries(fields.map((field) => [field, undefined])) }
					: entry,
			];
		}),
	);
	return { config: { ...config, places }, skipped };
}
