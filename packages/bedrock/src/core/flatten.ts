import {
	asResourceKey,
	asRobloxAssetId,
	type ResourceKey,
	type RobloxAssetId,
} from "../types/ids.ts";
import type { Config, GamePassEntry } from "./schema.ts";

/**
 * Pre-I/O game-pass input the flattener emits. Extends the authored
 * `GamePassEntry` with the tag discriminator and the `ResourceKey`-branded
 * key so `buildDesired` can consume a flat tagged list and layer on the
 * SHA-256 icon digest.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type GamePassDesiredInput } from "bedrock";
 *
 * const input: GamePassDesiredInput = {
 *     description: "Grants VIP perks.",
 *     iconFilePath: "assets/vip-icon.png",
 *     key: asResourceKey("vip-pass"),
 *     kind: "gamePass",
 *     name: "VIP Pass",
 *     price: 500,
 * };
 *
 * expect(input.kind).toBe("gamePass");
 * ```
 */
export interface GamePassDesiredInput extends Readonly<GamePassEntry> {
	/** User-supplied handle, already validated against the `ResourceKey` brand. */
	readonly key: ResourceKey;
	/** Discriminator tag for the `ResourceDesiredInput` union. */
	readonly kind: "gamePass";
}

/**
 * Pre-I/O place input the flattener emits. Extends the authored
 * `PlaceEntry` with the tag discriminator, the `ResourceKey`-branded key,
 * and the `RobloxAssetId`-branded `placeId` so `buildDesired` can consume
 * a flat tagged list and layer on the SHA-256 file digest.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, asRobloxAssetId, type PlaceDesiredInput } from "bedrock";
 *
 * const input: PlaceDesiredInput = {
 *     filePath: "places/start.rbxl",
 *     key: asResourceKey("start-place"),
 *     kind: "place",
 *     placeId: asRobloxAssetId("4711"),
 * };
 *
 * expect(input.kind).toBe("place");
 * ```
 */
export interface PlaceDesiredInput {
	/** User-supplied handle, already validated against the `ResourceKey` brand. */
	readonly key: ResourceKey;
	/** Path to the `.rbxl` or `.rbxlx` file; read by `buildDesired`. */
	readonly filePath: string;
	/** Discriminator tag for the `ResourceDesiredInput` union. */
	readonly kind: "place";
	/** Existing Roblox place ID, validated and branded at flatten time. */
	readonly placeId: RobloxAssetId;
}

/**
 * Flat tagged input for `buildDesired`. One member per resource kind; future
 * kinds widen this union as they land.
 */
export type ResourceDesiredInput = GamePassDesiredInput | PlaceDesiredInput;

/**
 * Turn a validated `Config` into a flat, tagged list of resource inputs.
 *
 * Pure and infallible: the schema has already enforced every invariant this
 * function relies on, so there is nothing left to fail. Entries appear in
 * the insertion order of each collection, and collections appear in the
 * order they are processed below (currently just `passes`).
 *
 * @param config - Validated config from `loadConfig` or `validateConfig`.
 * @returns Flat tagged list ready for `buildDesired`.
 * @example
 *
 * ```ts
 * import { flattenConfig, type Config } from "bedrock";
 *
 * const config: Config = {
 *     passes: {
 *         "vip-pass": {
 *             description: "Grants VIP perks.",
 *             iconFilePath: "assets/vip-icon.png",
 *             name: "VIP Pass",
 *             price: 500,
 *         },
 *     },
 * };
 *
 * const inputs = flattenConfig(config);
 * expect(inputs).toHaveLength(1);
 * expect(inputs[0]!.kind).toBe("gamePass");
 * expect(inputs[0]!.key).toBe("vip-pass");
 * ```
 */
export function flattenConfig(config: Config): ReadonlyArray<ResourceDesiredInput> {
	const out: Array<ResourceDesiredInput> = [];
	for (const [key, entry] of Object.entries(config.passes ?? {})) {
		out.push({
			key: asResourceKey(key),
			name: entry.name,
			description: entry.description,
			iconFilePath: entry.iconFilePath,
			kind: "gamePass",
			price: entry.price,
		});
	}

	for (const [key, entry] of Object.entries(config.places ?? {})) {
		out.push({
			key: asResourceKey(key),
			filePath: entry.filePath,
			kind: "place",
			placeId: asRobloxAssetId(entry.placeId),
		});
	}

	return out;
}
