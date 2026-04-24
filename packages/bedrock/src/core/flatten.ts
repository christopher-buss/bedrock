import {
	asResourceKey,
	asRobloxAssetId,
	type ResourceKey,
	type RobloxAssetId,
} from "../types/ids.ts";
import { UNIVERSE_SINGLETON_KEY } from "./resources.ts";
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
 * import { asResourceKey, type GamePassDesiredInput } from "@bedrock/core";
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
 * import { asResourceKey, asRobloxAssetId, type PlaceDesiredInput } from "@bedrock/core";
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
 * Pre-I/O universe input the flattener emits. Carries the fixed singleton
 * key (`"main"`) and the branded `universeId` so `buildDesired` can hand a
 * single tagged record downstream without a shape divergence for the
 * singleton kind.
 *
 * @example
 *
 * ```ts
 * import { asRobloxAssetId, UNIVERSE_SINGLETON_KEY, type UniverseDesiredInput } from "@bedrock/core";
 *
 * const input: UniverseDesiredInput = {
 *     consoleEnabled: undefined,
 *     desktopEnabled: true,
 *     key: UNIVERSE_SINGLETON_KEY,
 *     kind: "universe",
 *     mobileEnabled: undefined,
 *     tabletEnabled: undefined,
 *     universeId: asRobloxAssetId("1234567890"),
 *     voiceChatEnabled: true,
 *     vrEnabled: undefined,
 * };
 *
 * expect(input.kind).toBe("universe");
 * expect(input.key).toBe("main");
 * expect(input.desktopEnabled).toBeTrue();
 * ```
 */
export interface UniverseDesiredInput {
	/** Synthesized singleton key (`"main"`), already validated against the `ResourceKey` brand. */
	readonly key: ResourceKey;
	/** Whether console players can join; `undefined` leaves the server value untouched. */
	readonly consoleEnabled: boolean | undefined;
	/** Whether desktop players can join; `undefined` leaves the server value untouched. */
	readonly desktopEnabled: boolean | undefined;
	/** Discriminator tag for the `ResourceDesiredInput` union. */
	readonly kind: "universe";
	/** Whether mobile players can join; `undefined` leaves the server value untouched. */
	readonly mobileEnabled: boolean | undefined;
	/** Whether tablet players can join; `undefined` leaves the server value untouched. */
	readonly tabletEnabled: boolean | undefined;
	/** Existing Roblox universe ID, validated and branded at flatten time. */
	readonly universeId: RobloxAssetId;
	/** Whether voice chat is enabled; `undefined` leaves the server value untouched. */
	readonly voiceChatEnabled: boolean | undefined;
	/** Whether VR players can join; `undefined` leaves the server value untouched. */
	readonly vrEnabled: boolean | undefined;
}

/**
 * Flat tagged input for `buildDesired`. One member per resource kind; future
 * kinds widen this union as they land.
 */
export type ResourceDesiredInput = GamePassDesiredInput | PlaceDesiredInput | UniverseDesiredInput;

/**
 * Turn a validated `Config` into a flat, tagged list of resource inputs.
 *
 * Pure and infallible: the schema has already enforced every invariant this
 * function relies on, so there is nothing left to fail. Entries appear in
 * the insertion order of each collection; `passes` are emitted before
 * `places`.
 *
 * @param config - Validated config from `loadConfig` or `validateConfig`.
 * @returns Flat tagged list ready for `buildDesired`.
 * @example
 *
 * ```ts
 * import { flattenConfig, type Config } from "@bedrock/core";
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
 *     places: {
 *         "start-place": {
 *             filePath: "places/start.rbxl",
 *             placeId: "4711",
 *         },
 *     },
 * };
 *
 * const inputs = flattenConfig(config);
 * expect(inputs.map((input) => input.kind)).toEqual(["gamePass", "place"]);
 * expect(inputs.map((input) => input.key)).toEqual(["vip-pass", "start-place"]);
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

	if (config.universe !== undefined) {
		out.push(universeInput(config.universe));
	}

	return out;
}

function universeInput(entry: NonNullable<Config["universe"]>): UniverseDesiredInput {
	return {
		key: UNIVERSE_SINGLETON_KEY,
		consoleEnabled: entry.consoleEnabled,
		desktopEnabled: entry.desktopEnabled,
		kind: "universe",
		mobileEnabled: entry.mobileEnabled,
		tabletEnabled: entry.tabletEnabled,
		universeId: asRobloxAssetId(entry.universeId),
		voiceChatEnabled: entry.voiceChatEnabled,
		vrEnabled: entry.vrEnabled,
	};
}
