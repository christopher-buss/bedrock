import type { Result } from "@bedrock-rbx/ocale";

import type { StateError } from "./state.ts";

// Character class mirrors `RESOURCE_KEY_PATTERN_SOURCE` in types/ids.ts
// (both are "safe identifier" alphabets). They're kept in separate literals
// because the contracts are distinct: ResourceKey is unbounded, this one
// caps length at 64 so adapter-stored filenames can't exceed filesystem
// limits. If one alphabet changes, update the other deliberately.
/**
 * Source pattern for environment names, including `^` and `$` anchors.
 * Letters, digits, `-`, `_`, length 1-64.
 *
 * Exported so the config schema can validate `environments` keys against
 * the same alphabet and length cap that adapters enforce on storage
 * identifiers. Single source of truth: changing the alphabet here changes
 * both the runtime check and the schema-level key constraint.
 *
 * Anchors are embedded so callers do not have to re-add them, matching
 * the `RESOURCE_KEY_PATTERN_SOURCE` convention in `types/ids.ts`.
 */
export const ENV_NAME_PATTERN_SOURCE = "^[A-Za-z0-9_-]{1,64}$";

const ENVIRONMENT_NAME_PATTERN = new RegExp(ENV_NAME_PATTERN_SOURCE);

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
 * import { validateEnvironmentName } from "@bedrock-rbx/core";
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
