/**
 * Value that turns a config field off. Write it where Roblox has a real
 * "no value" state: a game-pass or developer-product `price` (off sale),
 * the universe `privateServerPriceRobux` (private servers off), and each
 * universe social link (no link shown).
 *
 * At the root it sets the field off. In an environment overlay it turns
 * off a value the root declares; an overlay that omits the key inherits
 * the root value instead. Configs in YAML, JSON, or Luau write the string
 * `"$none"`.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { none, selectEnvironment } from "@bedrock-rbx/core";
 * import type { Config } from "@bedrock-rbx/core/config";
 *
 * const config: Config = {
 *     environments: {
 *         production: {},
 *         staging: { products: { "gem-pack": { price: none } } },
 *     },
 *     products: { "gem-pack": { name: "Gem Pack", description: "Gems.", price: 100 } },
 * };
 *
 * const staging = selectEnvironment(config, "staging");
 * const production = selectEnvironment(config, "production");
 *
 * expect(staging.success && staging.data.products?.["gem-pack"]?.price).toBeUndefined();
 * expect(production.success && production.data.products?.["gem-pack"]?.price).toBe(100);
 * ```
 */
export const none = "$none";

/**
 * Type of {@link none}.
 *
 * @since unreleased
 */
export type None = typeof none;

/**
 * Entry shape after the overlay merge and {@link resolveNone}: every
 * optional field may carry `undefined`, which is how a field set to
 * {@link none} reaches the resource drivers.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 *
 * @template T - Authored entry shape.
 */
export type ResolveNone<T> = {
	[Key in keyof T]: Partial<Pick<T, Key>> extends Pick<T, Key>
		? Exclude<T[Key], None> | undefined
		: T[Key];
};

/**
 * Replace every {@link none} value on an entry with a present `undefined`
 * key, the shape downstream code reads as off sale or "clear on Roblox".
 *
 * @template T - Authored entry shape.
 * @param entry - Entry after the overlay merge.
 * @returns The entry with `none` values replaced.
 */
export function resolveNone<T extends object>(entry: T): ResolveNone<T> {
	// eslint-disable-next-line ts/no-unsafe-type-assertion -- Object.fromEntries loses the key-to-value mapping this mapped type restores
	return Object.fromEntries(
		Object.entries(entry).map(([key, value]) => [key, value === none ? undefined : value]),
	) as ResolveNone<T>;
}
