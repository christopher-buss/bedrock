import type { Simplify } from "type-fest";

import type { ResourceKey, RobloxAssetId, Sha256Hex } from "../types/ids.ts";

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
 * import { asResourceKey, asSha256Hex, type GamePassDesiredState } from "bedrock";
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
 * Discriminated union of every desired-state shape Bedrock manages.
 *
 * Extend by adding new members to this union; the mapped
 * `ResourceOutputsByKind` interface then forces a matching outputs entry for
 * the new kind at compile time.
 */
export type ResourceDesiredState = GamePassDesiredState;

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
 */
export interface ResourceOutputsByKind {
	/** Outputs returned by the Roblox API for a game-pass resource. */
	gamePass: GamePassOutputs;
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
 * object carrying Roblox-assigned identifiers. `Simplify` flattens the
 * intersection so tooltips and error messages show a single flat type,
 * not `Desired<K> & { outputs: Outputs<K> }`.
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
 * } from "bedrock";
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
export type ResourceCurrentState<K extends ResourceKind = ResourceKind> = Simplify<
	Extract<ResourceDesiredState, { kind: K }> & { readonly outputs: ResourceOutputs<K> }
>;
