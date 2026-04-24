import {
	asResourceKey,
	type ResourceKey,
	type RobloxAssetId,
	type Sha256Hex,
} from "../types/ids.ts";
import type { UniverseVisibility } from "./schema.ts";

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
 * import { asResourceKey, asSha256Hex, type GamePassDesiredState } from "@bedrock/core";
 *
 * const pass: GamePassDesiredState = {
 *     description: "Grants VIP perks.",
 *     iconFileHash: asSha256Hex(
 *         "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *     ),
 *     iconFilePath: "assets/vip-icon.png",
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
	 * SHA-256 hex digest of the icon file, computed by `buildDesired` in shell.
	 * Used by `diff` to detect icon changes without re-uploading unchanged files.
	 */
	readonly iconFileHash: Sha256Hex;
	/** Path to the icon file on disk, relative to the config file. */
	readonly iconFilePath: string;
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
 * re-uploading unchanged content.
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     type PlaceDesiredState,
 * } from "@bedrock/core";
 *
 * const place: PlaceDesiredState = {
 *     fileHash: asSha256Hex(
 *         "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *     ),
 *     filePath: "places/start.rbxl",
 *     key: asResourceKey("start-place"),
 *     kind: "place",
 *     placeId: asRobloxAssetId("4711"),
 * };
 *
 * expect(place.kind).toBe("place");
 * expect(place.placeId).toBe("4711");
 * ```
 */
export interface PlaceDesiredState {
	/** User-supplied key; stable across deploys; used to correlate desired with current. */
	readonly key: ResourceKey;
	/** SHA-256 hex digest of the place file, computed by `buildDesired` in shell. */
	readonly fileHash: Sha256Hex;
	/** Path to the `.rbxl` or `.rbxlx` file on disk, relative to the config file. */
	readonly filePath: string;
	/** Discriminator tag for the `ResourceDesiredState` union. */
	readonly kind: "place";
	/** Existing Roblox place ID; Open Cloud cannot create places, so this is an input, not an output. */
	readonly placeId: RobloxAssetId;
}

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
 * reconciles the declared managed fields against it. Managed fields use
 * `T | undefined` to mean "unmanaged" - the diff treats undefined as
 * absent and the driver omits the field from the `updateMask`. The
 * `privateServerPriceRobux` field is additionally key-presence aware:
 * a present key with `undefined` tells the driver to clear the server
 * value rather than leave it untouched.
 *
 * @example
 *
 * ```ts
 * import {
 *     asRobloxAssetId,
 *     UNIVERSE_SINGLETON_KEY,
 *     type UniverseDesiredState,
 * } from "@bedrock/core";
 *
 * const universe: UniverseDesiredState = {
 *     consoleEnabled: undefined,
 *     desktopEnabled: true,
 *     displayName: "Fun Universe",
 *     key: UNIVERSE_SINGLETON_KEY,
 *     kind: "universe",
 *     mobileEnabled: false,
 *     privateServerPriceRobux: undefined,
 *     tabletEnabled: undefined,
 *     universeId: asRobloxAssetId("1234567890"),
 *     visibility: "public",
 *     voiceChatEnabled: true,
 *     vrEnabled: undefined,
 * };
 *
 * expect(universe.kind).toBe("universe");
 * expect("privateServerPriceRobux" in universe).toBeTrue();
 * ```
 */
export interface UniverseDesiredState {
	/** Fixed singleton key (`"main"`); bedrock synthesizes it in `flattenConfig`. */
	readonly key: ResourceKey;
	/** Whether console players can join; `undefined` leaves the server value untouched. */
	readonly consoleEnabled: boolean | undefined;
	/** Whether desktop players can join; `undefined` leaves the server value untouched. */
	readonly desktopEnabled: boolean | undefined;
	/**
	 * Display name for the universe. `undefined` leaves the server
	 * value untouched. The driver routes declared updates through
	 * `PlacesClient.update` because the universe PATCH endpoint treats
	 * `displayName` as read-only.
	 */
	readonly displayName: string | undefined;
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
	/** Whether tablet players can join; `undefined` leaves the server value untouched. */
	readonly tabletEnabled: boolean | undefined;
	/** User-supplied Roblox universe ID; the universe must already exist. */
	readonly universeId: RobloxAssetId;
	/**
	 * Universe visibility. Declaring `"private"` immediately removes
	 * active players from running servers; `undefined` leaves the
	 * server value untouched.
	 */
	readonly visibility: undefined | UniverseVisibility;
	/** Whether voice chat is enabled; `undefined` leaves the server value untouched. */
	readonly voiceChatEnabled: boolean | undefined;
	/** Whether VR players can join; `undefined` leaves the server value untouched. */
	readonly vrEnabled: boolean | undefined;
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
 * Discriminated union of every desired-state shape Bedrock manages.
 *
 * Extend by adding new members to this union; the mapped
 * `ResourceOutputsByKind` interface then forces a matching outputs entry for
 * the new kind at compile time.
 */
export type ResourceDesiredState = GamePassDesiredState | PlaceDesiredState | UniverseDesiredState;

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
	/** Roblox asset ID of the uploaded icon image. */
	readonly iconAssetId: RobloxAssetId;
}

/**
 * Roblox-returned value produced by reconciling a universe. The root place
 * ID is server-authoritative: bedrock cannot set it directly, but records it
 * so a future places slice can cross-validate the declared start place.
 */
export interface UniverseOutputs {
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
 * import { asRobloxAssetId, type ResourceOutputsByKind } from "@bedrock/core";
 *
 * const outputs: ResourceOutputsByKind["gamePass"] = {
 *     assetId: asRobloxAssetId("9876543210"),
 *     iconAssetId: asRobloxAssetId("1122334455"),
 * };
 *
 * expect(outputs.assetId).toBe("9876543210");
 * ```
 */
export interface ResourceOutputsByKind {
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
 * } from "@bedrock/core";
 *
 * const current: ResourceCurrentState<"gamePass"> = {
 *     description: "Grants VIP perks.",
 *     iconFileHash: asSha256Hex(
 *         "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *     ),
 *     iconFilePath: "assets/vip-icon.png",
 *     key: asResourceKey("vip-pass"),
 *     kind: "gamePass",
 *     name: "VIP Pass",
 *     outputs: {
 *         assetId: asRobloxAssetId("9876543210"),
 *         iconAssetId: asRobloxAssetId("1122334455"),
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

/**
 * Fixed stable key for the singleton universe resource. `flattenConfig`
 * stamps this onto the sole `UniverseDesiredInput` it emits; fixtures and
 * state adapters share the constant so the invariant is encoded once.
 *
 * @example
 *
 * ```ts
 * import { UNIVERSE_SINGLETON_KEY } from "@bedrock/core";
 *
 * expect(UNIVERSE_SINGLETON_KEY).toBe("main");
 * ```
 */
// Module-init const; perTest coverage can't attribute it to any test.
// Stryker disable next-line all
export const UNIVERSE_SINGLETON_KEY: ResourceKey = asResourceKey("main");
