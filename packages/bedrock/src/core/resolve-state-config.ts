import type { Result } from "@bedrock-rbx/ocale";

import type { StateConfig } from "./schema.ts";

/**
 * Failure surfaced when no `StateConfig` is configured for the requested
 * environment. The shell layer wraps this in a `DeployError` when default
 * state-port construction is requested but the project has not declared
 * where state should live.
 *
 * @since 0.1.0
 */
export interface StateNotConfiguredError {
	/** Environment that the resolver was called against. */
	readonly environment: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "stateNotConfigured";
}

/**
 * Minimal structural input the state resolver needs. Both `Config`
 * (pre-merge, discriminated XOR union) and `ResolvedConfig` (post-merge)
 * satisfy this shape, so callers can route either in without coupling
 * the resolver to the discriminated-union arms.
 */
interface StateResolutionInputs {
	readonly environments: Record<string, undefined | { readonly state?: StateConfig }>;
	readonly state?: StateConfig;
}

/**
 * Pick the `StateConfig` that applies to `environment`. Per-environment
 * overrides win over the root block; if neither is present, returns
 * `Err(stateNotConfigured)` so the deploy boundary can surface a typed
 * error instead of silently falling back.
 *
 * @since 0.1.0
 *
 * @param config - Validated project config.
 * @param environment - Target environment name.
 * @returns The resolved `StateConfig`, or `Err(stateNotConfigured)` when
 * neither the environment override nor the root block is set.
 * @example
 *
 * ```ts
 * import { resolveStateConfig } from "@bedrock-rbx/core";
 *
 * const result = resolveStateConfig(
 *     {
 *         state: { backend: "gist", gistId: "root-gist" },
 *         environments: {
 *             production: { state: { backend: "gist", gistId: "prod-gist" } },
 *         },
 *     },
 *     "production",
 * );
 *
 * expect(result.success).toBeTrue();
 * if (result.success) {
 *     expect(result.data).toContainEntry(["gistId", "prod-gist"]);
 * }
 * ```
 */
export function resolveStateConfig(
	config: StateResolutionInputs,
	environment: string,
): Result<StateConfig, StateNotConfiguredError> {
	const override = config.environments[environment]?.state;
	if (override !== undefined) {
		return { data: override, success: true };
	}

	if (config.state !== undefined) {
		return { data: config.state, success: true };
	}

	return { err: { environment, kind: "stateNotConfigured" }, success: false };
}
