import type { SocialLink } from "@bedrock/ocale/universes";

import type { ResourceKey, RobloxAssetId } from "../types/ids.ts";
import { defaultKindRegistry } from "./kinds/index.ts";
import type { ResourceKindModule } from "./kinds/module.ts";
import type { ResourceKind } from "./resources.ts";
import type { DeveloperProductEntry, GamePassEntry, ResolvedConfig } from "./schema.ts";

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
 *     icon: { "en-us": "assets/vip-icon.png" },
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
 * Pre-I/O place input the flattener emits. Carries the resolved place
 * fields (`filePath` from the root, `placeId` from the per-environment
 * overlay) plus the optional metadata fields and the tag discriminator and
 * the `ResourceKey`-branded key, so `buildDesired` can consume a flat
 * tagged list and layer on the SHA-256 file digest.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, asRobloxAssetId, type PlaceDesiredInput } from "@bedrock/core";
 *
 * const input: PlaceDesiredInput = {
 *     description: undefined,
 *     displayName: "Start Place",
 *     filePath: "places/start.rbxl",
 *     key: asResourceKey("start-place"),
 *     kind: "place",
 *     placeId: asRobloxAssetId("4711"),
 *     serverSize: 50,
 * };
 *
 * expect(input.kind).toBe("place");
 * expect(input.displayName).toBe("Start Place");
 * ```
 */
export interface PlaceDesiredInput {
	/** User-supplied handle, already validated against the `ResourceKey` brand. */
	readonly key: ResourceKey;
	/** User-facing place description; `undefined` leaves the server value untouched. */
	readonly description: string | undefined;
	/** User-facing place name; `undefined` leaves the server value untouched. */
	readonly displayName: string | undefined;
	/** Path to the `.rbxl` or `.rbxlx` file; read by `buildDesired`. */
	readonly filePath: string;
	/** Discriminator tag for the `ResourceDesiredInput` union. */
	readonly kind: "place";
	/** Existing Roblox place ID, validated and branded at flatten time. */
	readonly placeId: RobloxAssetId;
	/** Maximum players per server; `undefined` leaves the server value untouched. */
	readonly serverSize: number | undefined;
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
 *     displayName: undefined,
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
	/** Discord social link; tri-state (absent/undefined/set) — see `UniverseDesiredState`. */
	readonly discordSocialLink?: SocialLink | undefined;
	/**
	 * Display name for the universe. `undefined` leaves the server value
	 * untouched. The driver routes declared updates through
	 * `PlacesClient.update` because the universe PATCH endpoint treats
	 * `displayName` as read-only.
	 */
	readonly displayName: string | undefined;
	/** Facebook social link; tri-state (absent/undefined/set) — see `UniverseDesiredState`. */
	readonly facebookSocialLink?: SocialLink | undefined;
	/** Guilded social link; tri-state (absent/undefined/set) — see `UniverseDesiredState`. */
	readonly guildedSocialLink?: SocialLink | undefined;
	/**
	 * Locale-keyed experience-icon paths copied from the user-supplied
	 * `UniverseEntry`. Absent when the user did not declare an icon block.
	 */
	readonly icon?: Record<"en-us", string>;
	/** Discriminator tag for the `ResourceDesiredInput` union. */
	readonly kind: "universe";
	/** Whether mobile players can join; `undefined` leaves the server value untouched. */
	readonly mobileEnabled: boolean | undefined;
	/**
	 * Private-server price in Robux. A present key with `undefined`
	 * clears the server value (ocale emits JSON `null`); an absent key
	 * leaves the server value untouched.
	 */
	readonly privateServerPriceRobux?: number | undefined;
	/** Roblox Group social link; tri-state (absent/undefined/set) — see `UniverseDesiredState`. */
	readonly robloxGroupSocialLink?: SocialLink | undefined;
	/** Whether tablet players can join; `undefined` leaves the server value untouched. */
	readonly tabletEnabled: boolean | undefined;
	/** Twitch social link; tri-state (absent/undefined/set) — see `UniverseDesiredState`. */
	readonly twitchSocialLink?: SocialLink | undefined;
	/** Twitter social link; tri-state (absent/undefined/set) — see `UniverseDesiredState`. */
	readonly twitterSocialLink?: SocialLink | undefined;
	/** Existing Roblox universe ID, validated and branded at flatten time. */
	readonly universeId: RobloxAssetId;
	/** Whether voice chat is enabled; `undefined` leaves the server value untouched. */
	readonly voiceChatEnabled: boolean | undefined;
	/** Whether VR players can join; `undefined` leaves the server value untouched. */
	readonly vrEnabled: boolean | undefined;
	/** YouTube social link; tri-state (absent/undefined/set) — see `UniverseDesiredState`. */
	readonly youtubeSocialLink?: SocialLink | undefined;
}

/**
 * Pre-I/O developer-product input the flattener emits. Extends the authored
 * `DeveloperProductEntry` with the tag discriminator and the
 * `ResourceKey`-branded key so `buildDesired` can consume a flat tagged
 * list. Slice 1 of #113 has no I/O work for this kind because the entry
 * does not (yet) reference a local file.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type DeveloperProductDesiredInput } from "@bedrock/core";
 *
 * const input: DeveloperProductDesiredInput = {
 *     description: "Stocks the player up with 1,000 premium gems.",
 *     key: asResourceKey("gem-pack"),
 *     kind: "developerProduct",
 *     name: "Gem Pack",
 * };
 *
 * expect(input.kind).toBe("developerProduct");
 * ```
 */
export interface DeveloperProductDesiredInput extends Readonly<DeveloperProductEntry> {
	/** User-supplied handle, already validated against the `ResourceKey` brand. */
	readonly key: ResourceKey;
	/** Discriminator tag for the `ResourceDesiredInput` union. */
	readonly kind: "developerProduct";
}

/**
 * Flat tagged input for `buildDesired`. One member per resource kind; future
 * kinds widen this union as they land.
 */
export type ResourceDesiredInput =
	| DeveloperProductDesiredInput
	| GamePassDesiredInput
	| PlaceDesiredInput
	| UniverseDesiredInput;

/**
 * Turn a resolved `Config` into a flat, tagged list of resource inputs.
 *
 * Pure and infallible: validation and per-environment overlay merging
 * have already happened upstream (typically via `selectEnvironment`), so
 * every invariant this function relies on is guaranteed by the input
 * shape. Entries appear in the insertion order of each collection;
 * `passes` are emitted before `places`.
 *
 * @param config - Resolved config returned by `selectEnvironment`.
 * @returns Flat tagged list ready for `buildDesired`.
 * @example
 *
 * ```ts
 * import { flattenConfig, selectEnvironment, type Config } from "@bedrock/core";
 *
 * const config: Config = {
 *     environments: {
 *         production: { places: { "start-place": { placeId: "4711" } } },
 *     },
 *     passes: {
 *         "vip-pass": {
 *             description: "Grants VIP perks.",
 *             icon: { "en-us": "assets/vip-icon.png" },
 *             name: "VIP Pass",
 *             price: 500,
 *         },
 *     },
 *     places: { "start-place": { filePath: "places/start.rbxl" } },
 * };
 *
 * const resolved = selectEnvironment(config, "production");
 * expect(resolved.success).toBeTrue();
 * if (resolved.success) {
 *     const inputs = flattenConfig(resolved.data);
 *     expect(inputs.map((input) => input.kind)).toEqual(["gamePass", "place"]);
 *     expect(inputs.map((input) => input.key)).toEqual(["vip-pass", "start-place"]);
 * }
 * ```
 */
export function flattenConfig(config: ResolvedConfig): ReadonlyArray<ResourceDesiredInput> {
	const modules = Object.values(defaultKindRegistry) as ReadonlyArray<
		ResourceKindModule<ResourceKind>
	>;
	return modules.flatMap((module) => module.flatten(config));
}
