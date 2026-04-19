import type { Tagged } from "type-fest";

const RESOURCE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * User-supplied identifier for a resource within a config (e.g. `"vip-pass"`).
 * Stable across deploys; used to correlate desired ↔ current state.
 */
export type ResourceKey = Tagged<string, "ResourceKey">;

/**
 * Validate and brand a raw string as a {@link ResourceKey}.
 *
 * Accepts non-empty strings of alphanumeric characters, hyphens, and
 * underscores (matching `/^[A-Za-z0-9_-]+$/`).
 *
 * @example
 *
 * ```ts
 * import { asResourceKey } from "bedrock";
 *
 * const key = asResourceKey("vip-pass");
 * expect(key).toBe("vip-pass");
 * expect(() => asResourceKey("vip pass")).toThrow(RangeError);
 * ```
 *
 * @param raw - Raw string to validate and brand.
 * @returns The input re-typed as a {@link ResourceKey}.
 * @throws RangeError when `raw` is empty or contains disallowed characters.
 */
export function asResourceKey(raw: string): ResourceKey {
	if (!RESOURCE_KEY_PATTERN.test(raw)) {
		throw new RangeError(
			`ResourceKey must match ${String(RESOURCE_KEY_PATTERN)} (got ${JSON.stringify(raw)})`,
		);
	}

	return raw as ResourceKey;
}
