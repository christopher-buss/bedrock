import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import type { Config } from "./schema.ts";

/**
 * Pre-I/O game-pass input the flattener emits. `buildDesired` consumes a
 * `ReadonlyArray<ResourceDesiredInput>` and layers on the fields that require
 * I/O (the SHA-256 digest of the icon file).
 *
 * Every field except `iconFileHash` on `GamePassDesiredState` is present at
 * this stage. Split out into its own shape so the schema and `buildDesired`
 * don't share a single "partially populated" type.
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
export interface GamePassDesiredInput {
	/** User-supplied handle, already validated against the `ResourceKey` brand. */
	readonly key: ResourceKey;
	/** Name shown on the Roblox storefront. */
	readonly name: string;
	/** Description shown on the game-pass detail page. */
	readonly description: string;
	/** Path to the icon file; handed to the injected `readFile` without resolution. */
	readonly iconFilePath: string;
	/** Discriminator tag for the `ResourceDesiredInput` union. */
	readonly kind: "gamePass";
	/** Robux price, or `undefined` for off-sale. */
	readonly price: number | undefined;
}

/**
 * Flat tagged input for `buildDesired`. One member per resource kind; future
 * kinds widen this union as they land.
 */
export type ResourceDesiredInput = GamePassDesiredInput;

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
 * expect(inputs[0]?.kind).toBe("gamePass");
 * expect(inputs[0]?.key).toBe("vip-pass");
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

	return out;
}
