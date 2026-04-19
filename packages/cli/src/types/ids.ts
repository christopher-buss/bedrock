import type { Tagged } from "type-fest";

const RESOURCE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

const ROBLOX_ASSET_ID_PATTERN = /^\d+$/;

/**
 * User-supplied identifier for a resource within a config (e.g. `"vip-pass"`).
 * Stable across deploys; used to correlate desired ↔ current state.
 */
export type ResourceKey = Tagged<string, "ResourceKey">;

/**
 * Roblox-assigned numeric asset ID, represented as a string to avoid int64
 * precision loss in JavaScript.
 */
export type RobloxAssetId = Tagged<string, "RobloxAssetId">;

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

/**
 * Type predicate: test whether a raw string is a valid {@link RobloxAssetId}.
 *
 * Prefer this when the caller owns error handling (for example, constructing a
 * `Result` error in a shell-layer parser). Use {@link asRobloxAssetId} when an
 * exception is the right failure mode.
 *
 * @example
 *
 * ```ts
 * import { isRobloxAssetId } from "bedrock";
 *
 * const valid = isRobloxAssetId("12345");
 * const invalid = isRobloxAssetId("12345abc");
 * expect(valid).toBe(true);
 * expect(invalid).toBe(false);
 * ```
 *
 * @param raw - String to test.
 * @returns `true` when `raw` matches the RobloxAssetId shape; narrows `raw`.
 */
export function isRobloxAssetId(raw: string): raw is RobloxAssetId {
	return ROBLOX_ASSET_ID_PATTERN.test(raw);
}

/**
 * Validate and brand a raw string as a {@link RobloxAssetId}.
 *
 * Accepts non-empty digit-only strings (matching `/^\d+$/`). Roblox asset IDs
 * are int64 values carried as strings because JavaScript's `number` cannot
 * represent the full int64 range.
 *
 * @example
 *
 * ```ts
 * import { asRobloxAssetId } from "bedrock";
 *
 * const id = asRobloxAssetId("12345");
 *
 * let thrown: unknown;
 * try {
 *     asRobloxAssetId("12345abc");
 * } catch (error) {
 *     thrown = error;
 * }
 *
 * expect(id).toBe("12345");
 * expect(thrown).toBeInstanceOf(RangeError);
 * ```
 *
 * @param raw - Raw string to validate and brand.
 * @returns The input re-typed as a {@link RobloxAssetId}.
 * @throws RangeError when `raw` is empty or contains non-digit characters.
 */
export function asRobloxAssetId(raw: string): RobloxAssetId {
	if (!isRobloxAssetId(raw)) {
		throw new RangeError(
			`RobloxAssetId must be a non-empty digit-only string matching ${String(
				ROBLOX_ASSET_ID_PATTERN,
			)} (got ${JSON.stringify(raw)})`,
		);
	}

	return raw;
}
