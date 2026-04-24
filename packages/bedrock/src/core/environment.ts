import type { Result } from "@bedrock/ocale";

import { RESOURCE_KEY_PATTERN_SOURCE } from "../types/ids.ts";
import type { StateError } from "./state.ts";

// Shares its character class with `RESOURCE_KEY_PATTERN_SOURCE` so the
// "safe identifier" alphabet has one source of truth; an environment name
// is not a `ResourceKey`, but both must be filesystem-safe, and diverging
// the alphabets silently would let one kind of name collide where the
// other is valid.
const ENVIRONMENT_CHARACTER_CLASS = RESOURCE_KEY_PATTERN_SOURCE.replace(/^\^|\+\$$/gu, "");
const ENVIRONMENT_NAME_PATTERN = new RegExp(`^${ENVIRONMENT_CHARACTER_CLASS}{1,64}$`, "u");

/**
 * Validate an environment name at a state-adapter boundary.
 *
 * Adapters that map environment names onto filesystem-like identifiers
 * (gist filenames, S3 keys) must reject names that could collide or escape
 * their storage layout. This helper accepts letters, digits, `-`, and `_`
 * only, with length between 1 and 64, and returns a `StateError` for
 * anything outside that set so the adapter can fail loudly instead of
 * silently stripping characters.
 *
 * @example
 *
 * ```ts
 * import { validateEnvironmentName } from "@bedrock/core";
 *
 * const ok = validateEnvironmentName("production");
 * expect(ok.success).toBeTrue();
 *
 * const bad = validateEnvironmentName("prod/staging");
 * expect(bad.success).toBeFalse();
 * ```
 *
 * @param environment - Raw environment name supplied by a caller.
 * @returns `Ok(environment)` when the name is safe to use, or
 * `Err(StateError)` with a descriptive reason when it is not.
 */
export function validateEnvironmentName(environment: string): Result<string, StateError> {
	if (!ENVIRONMENT_NAME_PATTERN.test(environment)) {
		return {
			err: {
				file: environment,
				kind: "stateError",
				reason: `invalid environment name: must match ${String(ENVIRONMENT_NAME_PATTERN)}`,
			},
			success: false,
		};
	}

	return { data: environment, success: true };
}
