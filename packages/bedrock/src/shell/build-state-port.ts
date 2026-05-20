import type { Result } from "@bedrock-rbx/ocale";

import { createGistStateAdapter, type GistFetch } from "../adapters/gist-state-adapter.ts";
import { type GistStateConfig, isGistStateConfig, type StateConfig } from "../core/schema.ts";
import type { StatePort } from "../ports/state-port.ts";

/**
 * Failure surfaced when a default-constructed adapter cannot find a
 * required environment variable. The deploy boundary wraps this in a
 * `DeployError` so the caller sees a typed Result instead of an
 * exception or a confusing downstream HTTP error.
 */
export interface MissingCredentialError {
	/** Literal discriminator for narrowing. */
	readonly kind: "missingCredential";
	/** Whether the credential was needed for the state backend or the driver registry. */
	readonly purpose: "registry" | "stateBackend";
	/** Environment variable name the default-construction path tried to read. */
	readonly variable: string;
}

/**
 * Failure surfaced when the dispatch helper sees a `state.backend` value
 * it does not recognize. The hint points at `opts.statePort` so the
 * caller can pass a custom adapter as an escape hatch.
 */
export interface UnsupportedBackendError {
	/** Backend name read from `state.backend`. */
	readonly backend: string;
	/** Suggested escape hatch routed back to the caller. */
	readonly hint: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "unsupportedBackend";
}

/** Inputs for {@link buildStatePort}. */
interface BuildStatePortDeps {
	/** Optional `fetch` seam plumbed through to the gist adapter for tests. */
	readonly fetch?: GistFetch | undefined;
	/** Reads an environment variable; injected so tests stay free of `process.env`. */
	readonly getEnv: (name: string) => string | undefined;
	/** Resolved state configuration for the target environment. */
	readonly stateConfig: StateConfig;
}

const STATE_PORT_HINT = "pass a custom statePort via opts.statePort";

/**
 * Construct a `StatePort` from a resolved `StateConfig`. Dispatches on
 * `stateConfig.backend` to the matching builtin adapter; reads the
 * required credential from `getEnv` and surfaces `missingCredential` or
 * `unsupportedBackend` as typed Results.
 *
 * @example
 *
 * ```ts
 * import { buildStatePort } from "@bedrock-rbx/core";
 *
 * const port = buildStatePort({
 *     fetch: async () =>
 *         new Response(JSON.stringify({ files: {} }), { status: 200 }),
 *     getEnv: (name) => (name === "BEDROCK_GITHUB_TOKEN" ? "ghp_example" : undefined),
 *     stateConfig: { backend: "gist", gistId: "abc123" },
 * });
 *
 * expect(port.success).toBeTrue();
 * ```
 *
 * @param deps - Resolved state config plus credential-injection seams.
 * @returns A `StatePort` on success, or a typed Err describing the
 * missing credential or the unsupported backend.
 */
export function buildStatePort(
	deps: BuildStatePortDeps,
): Result<StatePort, MissingCredentialError | UnsupportedBackendError> {
	if (isGistStateConfig(deps.stateConfig)) {
		return buildGistStatePort(deps.stateConfig, deps);
	}

	return {
		err: {
			backend: deps.stateConfig.backend,
			hint: STATE_PORT_HINT,
			kind: "unsupportedBackend",
		},
		success: false,
	};
}

function buildGistStatePort(
	stateConfig: GistStateConfig,
	deps: BuildStatePortDeps,
): Result<StatePort, MissingCredentialError> {
	const token = deps.getEnv("BEDROCK_GITHUB_TOKEN") ?? deps.getEnv("GITHUB_TOKEN");
	if (token === undefined) {
		return {
			err: {
				kind: "missingCredential",
				purpose: "stateBackend",
				variable: "BEDROCK_GITHUB_TOKEN",
			},
			success: false,
		};
	}

	return {
		data: createGistStateAdapter({
			fetch: deps.fetch,
			gistId: stateConfig.gistId,
			token,
		}),
		success: true,
	};
}
