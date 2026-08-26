import type { Result } from "@bedrock-rbx/ocale";

import { createGistStateAdapter, type GistFetch } from "../adapters/gist-state-adapter.ts";
import { EMPTY_PLUGIN_REGISTRY, type PluginRegistry } from "../core/plugin-registry.ts";
import type { RegisteredStateBackend } from "../core/plugin-registry.ts";
import type { StateBackendBuildError } from "../core/plugin.ts";
import { type GistStateConfig, isGistStateConfig, type StateConfig } from "../core/schema.ts";
import type { StateLockPort } from "../ports/state-lock-port.ts";
import type { StatePort } from "../ports/state-port.ts";

/**
 * Failure surfaced when a default-constructed adapter cannot find a
 * required environment variable. The deploy boundary wraps this in a
 * `DeployError` so the caller sees a typed Result instead of an
 * exception or a confusing downstream HTTP error.
 *
 * @since 0.1.0
 */
export interface MissingCredentialError {
	/** Literal discriminator for narrowing. */
	readonly kind: "missingCredential";
	/**
	 * Whether the credential was needed for the state backend or the driver
	 * registry.
	 */
	readonly purpose: "registry" | "stateBackend";
	/**
	 * Environment variable name the default-construction path tried to read.
	 */
	readonly variable: string;
}

/**
 * Failure surfaced when the dispatch helper sees a `state.backend` value
 * it does not recognize. The hint points at `opts.statePort` so the
 * caller can pass a custom adapter as an escape hatch.
 *
 * @since 0.1.0
 */
export interface UnsupportedBackendError {
	/** Backend name read from `state.backend`. */
	readonly backend: string;
	/** Suggested escape hatch routed back to the caller. */
	readonly hint: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "unsupportedBackend";
}

/**
 * Failure surfaced when a plugin's **Backend** builder refused to produce
 * an adapter. Carries the plugin's own `reason` and `detail` untouched
 * alongside the specifier that names the plugin, so core reports the
 * failure without enumerating the shapes a **Backend** can fail in.
 *
 * @since unreleased
 */
export interface PluginStateBackendError {
	/** The plugin's own payload, which core neither reads nor narrows. */
	readonly detail?: unknown;
	/** Literal discriminator for narrowing. */
	readonly kind: "pluginStateBackend";
	/** Why the plugin said it could not build the **Backend**. */
	readonly reason: string;
	/** Module specifier of the plugin whose **Backend** refused to build. */
	readonly specifier: string;
}

/**
 * The ports one **Backend** contributes: the **State port** it always
 * supplies, and the **State lock port** it supplies only when it declares
 * that it locks.
 *
 * @since unreleased
 */
export interface StateBackend {
	/**
	 * Exclusion around a **Deploy**, or `undefined` when the **Backend**
	 * declares none. A deploy against a **Backend** that declares none runs
	 * without taking a hold.
	 */
	readonly lockPort: StateLockPort | undefined;
	/** Persistence for the per-environment snapshot. */
	readonly statePort: StatePort;
}

/** Inputs for {@link buildStatePort}. */
interface BuildStatePortDependencies {
	/** Optional `fetch` seam plumbed through to the gist adapter for tests. */
	readonly fetch?: GistFetch | undefined;
	/**
	 * Reads an environment variable; injected so tests stay free of
	 * `process.env`.
	 */
	readonly getEnv: (name: string) => string | undefined;
	/**
	 * What the loaded plugins declared. A `state.backend` naming one of
	 * their **Backend**s builds through that plugin; omit it when no
	 * plugins are loaded.
	 */
	readonly plugins?: PluginRegistry | undefined;
	/** Resolved state configuration for the target environment. */
	readonly stateConfig: StateConfig;
}

const STATE_PORT_HINT = "pass a custom statePort via opts.statePort";

/**
 * Construct everything a **Backend** contributes from a resolved
 * `StateConfig`: its `StatePort`, and its `StateLockPort` when it declares
 * that it locks. Dispatches on `stateConfig.backend` exactly as
 * {@link buildStatePort} does, and surfaces the same typed failures.
 *
 * A **Backend** that declares no locking yields `lockPort: undefined`,
 * which is a valid **Backend**: the deploy then runs without exclusion
 * rather than refusing to run.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { buildStateBackend } from "@bedrock-rbx/core";
 *
 * const backend = buildStateBackend({
 *     fetch: async () =>
 *         new Response(JSON.stringify({ files: {} }), { status: 200 }),
 *     getEnv: (name) => (name === "BEDROCK_GITHUB_TOKEN" ? "ghp_example" : undefined),
 *     stateConfig: { backend: "gist", gistId: "abc123" },
 * });
 *
 * expect(backend.success).toBeTrue();
 * if (backend.success) {
 *     expect(backend.data.lockPort).toBeUndefined();
 * }
 * ```
 *
 * @param deps - Resolved state config plus credential-injection seams.
 * @returns The **Backend**'s ports on success, or a typed Err describing
 * the missing credential, the plugin's refusal, or the unsupported backend.
 */
export function buildStateBackend(
	deps: BuildStatePortDependencies,
): Result<
	StateBackend,
	MissingCredentialError | PluginStateBackendError | UnsupportedBackendError
> {
	if (isGistStateConfig(deps.stateConfig)) {
		return buildGistStateBackend(deps.stateConfig, deps);
	}

	const registered = (deps.plugins ?? EMPTY_PLUGIN_REGISTRY).stateBackends.get(
		deps.stateConfig.backend,
	);
	if (registered !== undefined) {
		return buildPluginStateBackend(registered, deps);
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

/**
 * Construct a `StatePort` from a resolved `StateConfig`. Dispatches on
 * `stateConfig.backend` to the matching builtin adapter; reads the
 * required credential from `getEnv` and surfaces `missingCredential` or
 * `unsupportedBackend` as typed Results.
 *
 * @since 0.1.0
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
	deps: BuildStatePortDependencies,
): Result<StatePort, MissingCredentialError | PluginStateBackendError | UnsupportedBackendError> {
	const backend = buildStateBackend(deps);
	return backend.success ? { data: backend.data.statePort, success: true } : backend;
}

/**
 * Name the plugin responsible for a refusal while passing its own payload
 * through untouched.
 *
 * @param registered - The **Backend** whose builder refused.
 * @param refusal - What the plugin said, which core neither reads nor
 * narrows.
 * @returns The `pluginStateBackend` failure core reports.
 */
function wrapPluginRefusal(
	registered: RegisteredStateBackend,
	refusal: StateBackendBuildError,
): PluginStateBackendError {
	return {
		detail: refusal.detail,
		kind: "pluginStateBackend",
		reason: refusal.reason,
		specifier: registered.specifier,
	};
}

/**
 * Build one plugin-declared **Backend**, mapping the plugin's refusal onto
 * the `pluginStateBackend` failure that names it. A declaration supplying
 * no lock builder claims no locking, so the **Backend** resolves with no
 * lock port rather than failing.
 *
 * @param registered - The **Backend** the loaded plugins claimed for this
 * `state.backend` value.
 * @param dependencies - The resolved `state` block plus the credential and
 * transport seams handed on to the plugin.
 * @returns The plugin's ports, or the wrapped refusal.
 */
function buildPluginStateBackend(
	registered: RegisteredStateBackend,
	dependencies: BuildStatePortDependencies,
): Result<StateBackend, PluginStateBackendError> {
	const context = {
		fetch: dependencies.fetch,
		getEnv: dependencies.getEnv,
		stateConfig: dependencies.stateConfig,
	};

	const built = registered.declaration.createPort(context);
	if (!built.success) {
		return { err: wrapPluginRefusal(registered, built.err), success: false };
	}

	const lock = registered.declaration.createLockPort?.(context);
	if (lock === undefined) {
		return { data: { lockPort: undefined, statePort: built.data }, success: true };
	}

	if (!lock.success) {
		return { err: wrapPluginRefusal(registered, lock.err), success: false };
	}

	return { data: { lockPort: lock.data, statePort: built.data }, success: true };
}

/**
 * Build the builtin gist **Backend**, which offers no atomic
 * create-if-absent and so declares no locking.
 *
 * @param stateConfig - The resolved gist `state` block.
 * @param dependencies - The credential and transport seams.
 * @returns The gist adapter with no lock port, or the missing credential.
 */
function buildGistStateBackend(
	stateConfig: GistStateConfig,
	dependencies: BuildStatePortDependencies,
): Result<StateBackend, MissingCredentialError> {
	const token =
		dependencies.getEnv("BEDROCK_GITHUB_TOKEN") ?? dependencies.getEnv("GITHUB_TOKEN");
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
		data: {
			lockPort: undefined,
			statePort: createGistStateAdapter({
				fetch: dependencies.fetch,
				gistId: stateConfig.gistId,
				token,
			}),
		},
		success: true,
	};
}
