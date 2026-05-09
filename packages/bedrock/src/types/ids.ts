import type { Tagged } from "type-fest";

/**
 * Regex source shared by the `ResourceKey` brand validator and the runtime
 * config schema. Kept as a string (not a `RegExp`) so arktype can consume it
 * directly in keyed-map signatures without re-escaping.
 */
export const RESOURCE_KEY_PATTERN_SOURCE = "^[A-Za-z0-9_-]+$";

const RESOURCE_KEY_PATTERN = new RegExp(RESOURCE_KEY_PATTERN_SOURCE);

const ROBLOX_ASSET_ID_PATTERN = /^\d+$/;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

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
 * Lowercase hex-encoded SHA-256 digest (exactly 64 characters drawn from
 * `0-9a-f`). Used to detect changes to file-backed resource inputs such as
 * game-pass icons without re-uploading the file.
 */
export type Sha256Hex = Tagged<string, "Sha256Hex">;

/**
 * Type predicate: test whether a raw string is a valid {@link ResourceKey}.
 *
 * Prefer this when the caller owns error handling (for example, constructing a
 * `Result` error in a shell-layer parser). Use {@link asResourceKey} when an
 * exception is the right failure mode.
 *
 * @example
 *
 * ```ts
 * import { isResourceKey } from "@bedrock-rbx/core";
 *
 * const valid = isResourceKey("vip-pass");
 * const invalid = isResourceKey("vip pass");
 * expect(valid).toBe(true);
 * expect(invalid).toBe(false);
 * ```
 *
 * @param raw - String to test.
 * @returns `true` when `raw` matches the ResourceKey shape; narrows `raw`.
 */
export function isResourceKey(raw: string): raw is ResourceKey {
	return RESOURCE_KEY_PATTERN.test(raw);
}

/**
 * Validate and brand a raw string as a {@link ResourceKey}.
 *
 * Accepts non-empty strings of alphanumeric characters, hyphens, and
 * underscores (matching `/^[A-Za-z0-9_-]+$/`).
 *
 * @example
 *
 * ```ts
 * import { asResourceKey } from "@bedrock-rbx/core";
 *
 * const key = asResourceKey("vip-pass");
 *
 * let thrown: unknown;
 * try {
 *     asResourceKey("vip pass");
 * } catch (error) {
 *     thrown = error;
 * }
 *
 * expect(key).toBe("vip-pass");
 * expect(thrown).toBeInstanceOf(RangeError);
 * ```
 *
 * @param raw - Raw string to validate and brand.
 * @returns The input re-typed as a {@link ResourceKey}.
 * @throws RangeError when `raw` is empty or contains disallowed characters.
 */
export function asResourceKey(raw: string): ResourceKey {
	if (!isResourceKey(raw)) {
		throw new RangeError(
			`ResourceKey must match ${String(RESOURCE_KEY_PATTERN)} (got ${JSON.stringify(raw)})`,
		);
	}

	return raw;
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
 * import { isRobloxAssetId } from "@bedrock-rbx/core";
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
 * import { asRobloxAssetId } from "@bedrock-rbx/core";
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

/**
 * Type predicate: test whether a raw string is a valid {@link Sha256Hex}.
 *
 * Accepts exactly 64 lowercase hexadecimal characters (matching
 * `/^[0-9a-f]{64}$/`). Prefer this when the caller owns error handling;
 * use {@link asSha256Hex} when throwing is the right failure mode.
 *
 * @example
 *
 * ```ts
 * import { isSha256Hex } from "@bedrock-rbx/core";
 *
 * const digest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
 * const valid = isSha256Hex(digest);
 * const invalid = isSha256Hex(digest.toUpperCase());
 * expect(valid).toBe(true);
 * expect(invalid).toBe(false);
 * ```
 *
 * @param raw - String to test.
 * @returns `true` when `raw` matches the Sha256Hex shape; narrows `raw`.
 */
export function isSha256Hex(raw: string): raw is Sha256Hex {
	return SHA256_HEX_PATTERN.test(raw);
}

/**
 * Validate and brand a raw string as a {@link Sha256Hex}.
 *
 * Accepts exactly 64 lowercase hexadecimal characters. Uppercase hex, lengths
 * other than 64, and any non-hex character are rejected so the brand is a
 * canonical representation.
 *
 * @example
 *
 * ```ts
 * import { asSha256Hex } from "@bedrock-rbx/core";
 *
 * const digest = asSha256Hex(
 *     "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 * );
 *
 * let thrown: unknown;
 * try {
 *     asSha256Hex("deadbeef");
 * } catch (error) {
 *     thrown = error;
 * }
 *
 * expect(digest).toHaveLength(64);
 * expect(thrown).toBeInstanceOf(RangeError);
 * ```
 *
 * @param raw - Raw string to validate and brand.
 * @returns The input re-typed as a {@link Sha256Hex}.
 * @throws RangeError when `raw` is not exactly 64 lowercase hex characters.
 */
export function asSha256Hex(raw: string): Sha256Hex {
	if (!isSha256Hex(raw)) {
		throw new RangeError(
			`Sha256Hex must be 64 lowercase hex characters matching ${String(
				SHA256_HEX_PATTERN,
			)} (got ${raw.length} chars: ${JSON.stringify(raw)})`,
		);
	}

	return raw;
}
