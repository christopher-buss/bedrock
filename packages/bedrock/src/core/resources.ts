import type { SocialLink } from "@bedrock-rbx/ocale/universes";

import {
	asResourceKey,
	type ResourceKey,
	type RobloxAssetId,
	type Sha256Hex,
} from "../types/ids.ts";

/**
 * Desired state for a game pass, as declared in user config.
 *
 * Each field is `readonly` because desired state is treated as an immutable
 * snapshot once normalized by `buildDesired`; downstream consumers (`diff`,
 * drivers) must not mutate it.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, asSha256Hex, type GamePassDesiredState } from "@bedrock-rbx/core";
 *
 * const pass: GamePassDesiredState = {
 *     description: "Grants VIP perks.",
 *     icon: { "en-us": "assets/vip-icon.png" },
 *     iconFileHashes: {
 *         "en-us": asSha256Hex(
 *             "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *         ),
 *     },
 *     key: asResourceKey("vip-pass"),
 *     kind: "gamePass",
 *     name: "VIP Pass",
 *     price: undefined,
 * };
 *
 * expect(pass.kind).toBe("gamePass");
 * expect(pass.price).toBeUndefined();
 * ```
 */
export interface GamePassDesiredState {
	/** User-supplied key; stable across deploys; used to correlate desired with current. */
	readonly key: ResourceKey;
	/** User-facing game-pass name as shown on the Roblox storefront. */
	readonly name: string;
	/** User-facing description shown on the game-pass detail page. */
	readonly description: string;
	/**
	 * Locale-keyed icon paths declared on the authored config. The Roblox
	 * game-pass API is monolingual, so only the `"en-us"` icon is ever
	 * uploaded; the map shape mirrors `UniverseDesiredState.icon` for
	 * cross-kind parity.
	 */
	readonly icon: Record<"en-us", string>;
	/**
	 * SHA-256 digests of the local icon files keyed by the same locales as
	 * the icon map. The diff compares this map against the prior current
	 * state so the driver re-uploads only when a file's bytes change.
	 */
	readonly iconFileHashes: Record<"en-us", Sha256Hex>;
	/** Discriminator tag for the `ResourceDesiredState` union. */
	readonly kind: "gamePass";
	/**
	 * Robux price. `undefined` means off-sale (mirrors Mantle's `Option<u32>`;
	 * the state parser normalizes JSON `null` to `undefined` at the wire
	 * boundary per the project type convention).
	 */
	readonly price: number | undefined;
}

/**
 * Desired state for a place, the `.rbxl` or `.rbxlx` file a universe serves
 * as one of its levels.
 *
 * `placeId` sits on desired state (rather than on outputs like
 * {@link GamePassOutputs.assetId}) because Roblox Open Cloud cannot mint
 * places; the user supplies the existing place ID per entry. `filePath` and
 * `fileHash` describe the local file the driver publishes; `buildDesired`
 * computes `fileHash` from the file bytes so `diff` can detect drift without
 * re-uploading unchanged content. `displayName`, `description`, and
 * `serverSize` are optional metadata fields routed through
 * `PlacesClient.update`; `undefined` leaves the server value untouched.
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     type PlaceDesiredState,
 * } from "@bedrock-rbx/core";
 *
 * const place: PlaceDesiredState = {
 *     description: undefined,
 *     displayName: "Start Place",
 *     fileHash: asSha256Hex(
 *         "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *     ),
 *     filePath: "places/start.rbxl",
 *     key: asResourceKey("start-place"),
 *     kind: "place",
 *     placeId: asRobloxAssetId("4711"),
 *     serverSize: 50,
 * };
 *
 * expect(place.kind).toBe("place");
 * expect(place.displayName).toBe("Start Place");
 * expect(place.description).toBeUndefined();
 * expect(place.serverSize).toBe(50);
 * ```
 */
export interface PlaceDesiredState {
	/** User-supplied key; stable across deploys; used to correlate desired with current. */
	readonly key: ResourceKey;
	/** User-facing place description; `undefined` leaves the server value untouched. */
	readonly description: string | undefined;
	/** User-facing place name; `undefined` leaves the server value untouched. */
	readonly displayName: string | undefined;
	/** SHA-256 hex digest of the place file, computed by `buildDesired` in shell. */
	readonly fileHash: Sha256Hex;
	/** Path to the `.rbxl` or `.rbxlx` file on disk, relative to the config file. */
	readonly filePath: string;
	/** Discriminator tag for the `ResourceDesiredState` union. */
	readonly kind: "place";
	/** Existing Roblox place ID; Open Cloud cannot create places, so this is an input, not an output. */
	readonly placeId: RobloxAssetId;
	/** Maximum players per server; positive integer. `undefined` leaves the server value untouched. */
	readonly serverSize: number | undefined;
}

/**
 * Ordered list of optional metadata fields the driver routes through
 * `PlacesClient.update`. Iterated by `placeKind.fieldsEqual` and the place
 * driver's parameter translator so drift detection and the constructed
 * `updateMask` cannot drift apart.
 */
export const PLACE_MANAGED_METADATA_FIELDS = [
	"displayName",
	"description",
	"serverSize",
] as const satisfies ReadonlyArray<keyof PlaceDesiredState>;

/**
 * Roblox-returned value produced by publishing a place version. The publish
 * endpoint does not return an asset ID (the `placeId` is supplied by the
 * caller); `versionNumber` is the only Roblox-assigned field the response
 * carries.
 */
export interface PlaceOutputs {
	/** Auto-incrementing version number assigned by Roblox on every publish. */
	readonly versionNumber: number;
}

/**
 * Desired state for the singleton universe a config manages.
 *
 * The universe is adopted rather than provisioned: the user supplies an
 * existing `universeId` (Open Cloud cannot mint universes) and bedrock
 * reconciles the declared managed fields against it.
 *
 * Most managed fields use `T | undefined` to mean "unmanaged": the diff
 * treats `undefined` as absent and the driver omits the field from the
 * `updateMask`. The clearable fields (`privateServerPriceRobux` and each
 * social link) are additionally key-presence aware: a present key with
 * `undefined` tells the driver to clear the server value (ocale emits
 * JSON `null`), while an absent key leaves the server value untouched.
 *
 * @example
 *
 * ```ts
 * import {
 *     asRobloxAssetId,
 *     UNIVERSE_SINGLETON_KEY,
 *     type UniverseDesiredState,
 * } from "@bedrock-rbx/core";
 *
 * const universe: UniverseDesiredState = {
 *     consoleEnabled: undefined,
 *     desktopEnabled: true,
 *     discordSocialLink: { title: "Join our Discord", uri: "https://discord.gg/example" },
 *     displayName: "Fun Universe",
 *     key: UNIVERSE_SINGLETON_KEY,
 *     kind: "universe",
 *     mobileEnabled: false,
 *     privateServerPriceRobux: undefined,
 *     tabletEnabled: undefined,
 *     twitterSocialLink: undefined,
 *     universeId: asRobloxAssetId("1234567890"),
 *     voiceChatEnabled: true,
 *     vrEnabled: undefined,
 * };
 *
 * expect(universe.kind).toBe("universe");
 * expect("privateServerPriceRobux" in universe).toBeTrue();
 * expect(universe.discordSocialLink?.title).toBe("Join our Discord");
 * expect(universe.twitterSocialLink).toBeUndefined();
 * ```
 */
export interface UniverseDesiredState {
	/** Fixed singleton key (`"main"`); bedrock synthesizes it in `flattenConfig`. */
	readonly key: ResourceKey;
	/** Whether console players can join; `undefined` leaves the server value untouched. */
	readonly consoleEnabled: boolean | undefined;
	/** Whether desktop players can join; `undefined` leaves the server value untouched. */
	readonly desktopEnabled: boolean | undefined;
	/** Discord social link; tri-state (absent/undefined/set) — see interface JSDoc. */
	readonly discordSocialLink?: SocialLink | undefined;
	/**
	 * Display name for the universe. `undefined` leaves the server
	 * value untouched. The driver routes declared updates through
	 * `PlacesClient.update` because the universe PATCH endpoint treats
	 * `displayName` as read-only.
	 */
	readonly displayName: string | undefined;
	/** Facebook social link; tri-state (absent/undefined/set) — see interface JSDoc. */
	readonly facebookSocialLink?: SocialLink | undefined;
	/** Guilded social link; tri-state (absent/undefined/set) — see interface JSDoc. */
	readonly guildedSocialLink?: SocialLink | undefined;
	/**
	 * Locale-keyed experience-icon paths declared on the authored config.
	 * Absent when the user did not declare an icon block.
	 */
	readonly icon?: Record<"en-us", string>;
	/**
	 * SHA-256 digests of the local icon files keyed by the same locales as
	 * the icon map. The diff compares this map against the prior current
	 * state so the driver re-uploads only when a file's bytes change.
	 */
	readonly iconFileHashes?: Record<"en-us", Sha256Hex>;
	/** Discriminator tag for the `ResourceDesiredState` union. */
	readonly kind: "universe";
	/** Whether mobile players can join; `undefined` leaves the server value untouched. */
	readonly mobileEnabled: boolean | undefined;
	/**
	 * Private-server price in Robux. A present key with `undefined`
	 * clears the server value on apply; an absent key leaves the server
	 * value untouched.
	 */
	readonly privateServerPriceRobux?: number | undefined;
	/** Roblox Group social link; tri-state (absent/undefined/set) — see interface JSDoc. */
	readonly robloxGroupSocialLink?: SocialLink | undefined;
	/** Whether tablet players can join; `undefined` leaves the server value untouched. */
	readonly tabletEnabled: boolean | undefined;
	/** Twitch social link; tri-state (absent/undefined/set) — see interface JSDoc. */
	readonly twitchSocialLink?: SocialLink | undefined;
	/** Twitter social link; tri-state (absent/undefined/set) — see interface JSDoc. */
	readonly twitterSocialLink?: SocialLink | undefined;
	/** User-supplied Roblox universe ID; the universe must already exist. */
	readonly universeId: RobloxAssetId;
	/** Whether voice chat is enabled; `undefined` leaves the server value untouched. */
	readonly voiceChatEnabled: boolean | undefined;
	/** Whether VR players can join; `undefined` leaves the server value untouched. */
	readonly vrEnabled: boolean | undefined;
	/** YouTube social link; tri-state (absent/undefined/set) — see interface JSDoc. */
	readonly youtubeSocialLink?: SocialLink | undefined;
}

/**
 * Ordered list of optional boolean managed fields on {@link UniverseDesiredState}.
 *
 * The driver translator and the diff's per-field equality guard both iterate
 * this list so they cannot drift apart. Order drives `updateMask` sequence in
 * generated requests.
 */
export const UNIVERSE_MANAGED_FLAGS = [
	"desktopEnabled",
	"mobileEnabled",
	"tabletEnabled",
	"consoleEnabled",
	"vrEnabled",
	"voiceChatEnabled",
] as const satisfies ReadonlyArray<keyof UniverseDesiredState>;

/** Key of an optional boolean managed field on {@link UniverseDesiredState}. */
export type UniverseManagedFlag = (typeof UNIVERSE_MANAGED_FLAGS)[number];

/**
 * Tuple of every social link field name on {@link UniverseDesiredState}.
 * Iterated by flatten, driver, and diff to handle the tri-state clearable
 * semantics uniformly across all seven fields.
 */
export const SOCIAL_LINK_FIELDS = [
	"discordSocialLink",
	"facebookSocialLink",
	"guildedSocialLink",
	"robloxGroupSocialLink",
	"twitchSocialLink",
	"twitterSocialLink",
	"youtubeSocialLink",
] as const satisfies ReadonlyArray<keyof UniverseDesiredState>;

/** Union of the seven social link field names on {@link UniverseDesiredState}. */
export type SocialLinkField = (typeof SOCIAL_LINK_FIELDS)[number];

/**
 * Desired state for a developer product, the consumable a player can buy via
 * `MarketplaceService:PromptProductPurchase`.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type DeveloperProductDesiredState } from "@bedrock-rbx/core";
 *
 * const product: DeveloperProductDesiredState = {
 *     description: "Stocks the player up with 1,000 premium gems.",
 *     isRegionalPricingEnabled: true,
 *     key: asResourceKey("gem-pack"),
 *     kind: "developerProduct",
 *     name: "Gem Pack",
 *     price: 100,
 *     storePageEnabled: true,
 * };
 *
 * expect(product.kind).toBe("developerProduct");
 * expect(product.price).toBe(100);
 * ```
 */
export interface DeveloperProductDesiredState {
	/** User-supplied key; stable across deploys; used to correlate desired with current. */
	readonly key: ResourceKey;
	/** User-facing developer product name as shown on the storefront. */
	readonly name: string;
	/** User-facing description shown on the developer product detail page. */
	readonly description: string;
	/**
	 * Locale-keyed icon paths declared on the authored config. Absent when
	 * the user did not declare an icon block. The Roblox developer-product
	 * API is monolingual, so only the `"en-us"` icon is ever uploaded; the
	 * map shape mirrors `GamePassDesiredState.icon` for cross-kind parity.
	 */
	readonly icon?: Record<"en-us", string>;
	/**
	 * SHA-256 digests of the local icon files keyed by the same locales as
	 * the icon map. The diff compares this map against the prior current
	 * state so the driver re-uploads only when a file's bytes change. Absent
	 * when `icon` is absent.
	 */
	readonly iconFileHashes?: Record<"en-us", Sha256Hex>;
	/**
	 * Whether Roblox-managed regional pricing applies to the product.
	 * Tri-state: `undefined` means the flag is unmanaged (the diff ignores
	 * it); a defined value is propagated to Roblox on every deploy.
	 */
	readonly isRegionalPricingEnabled: boolean | undefined;
	/** Discriminator tag for the `ResourceDesiredState` union. */
	readonly kind: "developerProduct";
	/**
	 * Robux price. `undefined` means off-sale; removing the field from config
	 * takes the product off-sale on the next deploy, re-adding puts it back
	 * on sale.
	 */
	readonly price: number | undefined;
	/**
	 * Whether the product appears on the universe's external store page.
	 * Tri-state: `undefined` means the flag is unmanaged. A defined value is
	 * applied via a follow-up PATCH after the create POST because the v2
	 * create endpoint does not accept this field.
	 */
	readonly storePageEnabled: boolean | undefined;
}

/**
 * Discriminated union of every desired-state shape Bedrock manages.
 *
 * Extend by adding new members to this union; the mapped
 * `ResourceOutputsByKind` interface then forces a matching outputs entry for
 * the new kind at compile time.
 */
export type ResourceDesiredState =
	| DeveloperProductDesiredState
	| GamePassDesiredState
	| PlaceDesiredState
	| UniverseDesiredState;

/**
 * Roblox-returned identifiers produced by creating or updating a game pass.
 *
 * Distinct from `GamePassDesiredState.key`: the desired-state key is a
 * user-supplied handle, while these IDs are assigned by Roblox and
 * discovered only after the first successful API call.
 */
export interface GamePassOutputs {
	/** Primary Roblox asset ID for the game pass itself. */
	readonly assetId: RobloxAssetId;
	/**
	 * Locale-keyed Roblox-assigned image IDs for the game-pass icons.
	 * Mirrors `UniverseOutputs.iconAssetIds` for cross-kind shape parity;
	 * the Roblox game-pass API only ever populates the `"en-us"` entry.
	 */
	readonly iconAssetIds: Record<"en-us", RobloxAssetId>;
}

/**
 * Roblox-returned identifiers produced by creating or updating a developer
 * product. `productId` is what `MarketplaceService:PromptProductPurchase`
 * accepts and is stable across re-deploys. `iconImageAssetId` is optional
 * because the wire returns it as nullable when no icon is uploaded; slice 1
 * never populates it because icon support lands in a later slice.
 */
export interface DeveloperProductOutputs {
	/** Roblox asset ID of the uploaded icon image; `undefined` when no icon is uploaded. */
	readonly iconImageAssetId?: RobloxAssetId | undefined;
	/** Roblox-assigned developer product ID; stable across re-deploys. */
	readonly productId: RobloxAssetId;
}

/**
 * Roblox-returned value produced by reconciling a universe. The root place
 * ID is server-authoritative: bedrock cannot set it directly, but records it
 * so a future places slice can cross-validate the declared start place.
 */
export interface UniverseOutputs {
	/**
	 * Locale-keyed Roblox-assigned image IDs for the experience icons. Only
	 * populated for locales whose icon was uploaded by the universe driver;
	 * the entry persists across re-deploys until the locale is removed from
	 * the authored config.
	 */
	readonly iconAssetIds?: Record<"en-us", RobloxAssetId>;
	/** Server-assigned root place ID for the universe. */
	readonly rootPlaceId: RobloxAssetId;
}

/**
 * String union of every discriminator tag in `ResourceDesiredState`.
 *
 * Derived from the union rather than hand-maintained so adding a new
 * `ResourceDesiredState` member automatically widens this type.
 */
export type ResourceKind = ResourceDesiredState["kind"];

/**
 * Per-kind outputs registry. Each `ResourceKind` must have a matching entry
 * or `ResourceOutputs<K>` is a compile error. Modelled as an interface (not a
 * type alias) so downstream packages can use declaration merging to register
 * outputs for new kinds without touching this module.
 *
 * @example
 *
 * ```ts
 * import { asRobloxAssetId, type ResourceOutputsByKind } from "@bedrock-rbx/core";
 *
 * const outputs: ResourceOutputsByKind["gamePass"] = {
 *     assetId: asRobloxAssetId("9876543210"),
 *     iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
 * };
 *
 * expect(outputs.assetId).toBe("9876543210");
 * ```
 */
export interface ResourceOutputsByKind {
	/** Outputs returned by the Roblox API for a developer-product resource. */
	developerProduct: DeveloperProductOutputs;
	/** Outputs returned by the Roblox API for a game-pass resource. */
	gamePass: GamePassOutputs;
	/** Outputs returned by the Roblox API for a place publish. */
	place: PlaceOutputs;
	/** Outputs returned by the Roblox API for a universe reconcile. */
	universe: UniverseOutputs;
}

/**
 * Resolved outputs for a specific resource kind.
 *
 * @template K - The resource kind discriminator.
 */
export type ResourceOutputs<K extends ResourceKind> = ResourceOutputsByKind[K];

/**
 * Current (live) state for a resource kind.
 *
 * Composed from the matching desired-state shape plus a nested `outputs`
 * object carrying Roblox-assigned identifiers. The outer `K extends
 * ResourceKind` conditional distributes `K` across the union so the default
 * `ResourceCurrentState` resolves to a clean per-kind union rather than a
 * cross-product intersection of every kind's fields.
 *
 * The `outputs` sub-object stays nested (rather than flattening into the
 * top level) to mirror Mantle's `{ inputs, outputs }` state layout,
 * keeping migration copy clean.
 *
 * @template K - The resource kind discriminator. Defaults to the full
 * `ResourceKind` union for the broad form used in `ReadonlyArray`
 * collections.
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     type ResourceCurrentState,
 * } from "@bedrock-rbx/core";
 *
 * const current: ResourceCurrentState<"gamePass"> = {
 *     description: "Grants VIP perks.",
 *     icon: { "en-us": "assets/vip-icon.png" },
 *     iconFileHashes: {
 *         "en-us": asSha256Hex(
 *             "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *         ),
 *     },
 *     key: asResourceKey("vip-pass"),
 *     kind: "gamePass",
 *     name: "VIP Pass",
 *     outputs: {
 *         assetId: asRobloxAssetId("9876543210"),
 *         iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
 *     },
 *     price: 500,
 * };
 *
 * expect(current.outputs.assetId).toBe("9876543210");
 * expect(current.kind).toBe("gamePass");
 * ```
 */
export type ResourceCurrentState<K extends ResourceKind = ResourceKind> = K extends ResourceKind
	? Prettify<
			Extract<ResourceDesiredState, { kind: K }> & { readonly outputs: ResourceOutputs<K> }
		>
	: never;

type Prettify<T> = { readonly [K in keyof T]: T[K] };

type WithOptionalSocialLinks = Readonly<Partial<Record<SocialLinkField, SocialLink | undefined>>>;

/**
 * Copy every social link field that is present as a key on `source`,
 * preserving the tri-state distinction between "key absent" (unmanaged,
 * omitted from result) and "key present with `undefined`" (cleared,
 * forwarded as-is). Shared by flatten, build-desired, and the universe
 * driver so all three layers propagate the same tri-state semantics.
 *
 * @param source - Object whose declared social link keys should be copied.
 * @returns Partial record containing only the social link keys present on
 *   `source`; absent keys stay absent.
 */
export function copyDeclaredSocialLinks(
	source: WithOptionalSocialLinks,
): Partial<Record<SocialLinkField, SocialLink | undefined>> {
	const copied: Partial<Record<SocialLinkField, SocialLink | undefined>> = {};
	for (const field of SOCIAL_LINK_FIELDS) {
		if (field in source) {
			copied[field] = source[field];
		}
	}

	return copied;
}

/**
 * Fixed stable key for the singleton universe resource. `flattenConfig`
 * stamps this onto the sole `UniverseDesiredInput` it emits; fixtures and
 * state adapters share the constant so the invariant is encoded once.
 *
 * @example
 *
 * ```ts
 * import { UNIVERSE_SINGLETON_KEY } from "@bedrock-rbx/core";
 *
 * expect(UNIVERSE_SINGLETON_KEY).toBe("main");
 * ```
 */
export const UNIVERSE_SINGLETON_KEY: ResourceKey = asResourceKey("main");
