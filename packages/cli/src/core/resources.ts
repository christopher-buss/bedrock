import type { ResourceKey, Sha256Hex } from "../types/ids.ts";

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
