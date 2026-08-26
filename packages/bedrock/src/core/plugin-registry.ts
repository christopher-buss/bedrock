import type { Result } from "@bedrock-rbx/ocale";

import type { ConfigError } from "./config-error.ts";
import type { BedrockPlugin, StateBackendDeclaration, StateBackendSchema } from "./plugin.ts";

/**
 * Module specifier core reports as the claimant of a builtin **Backend**
 * name, so a collision with a builtin reads the same as a collision
 * between two plugins.
 */
const BUILTIN_SPECIFIER = "@bedrock-rbx/core";

/** **Backend** names core ships, which no plugin may claim. */
const BUILTIN_STATE_BACKENDS: ReadonlySet<string> = new Set(["gist"]);

/**
 * One plugin module that imported successfully, paired with the specifier
 * the config named it by.
 *
 * @since unreleased
 */
export interface LoadedPlugin {
	/** The plugin object the module default-exported. */
	readonly plugin: BedrockPlugin;
	/** Module specifier the config listed under `plugins`. */
	readonly specifier: string;
}

/**
 * What the loaded plugins collectively contribute, resolved once per
 * config load and read wherever a plugin's declaration is needed.
 *
 * @since unreleased
 */
export interface PluginRegistry {
	/** Schema fragment for each plugin-declared **Backend**, keyed by name. */
	readonly stateBackends: ReadonlyMap<string, StateBackendSchema>;
}

/**
 * The registry a config load with no plugins produces.
 *
 * @since unreleased
 */
export const EMPTY_PLUGIN_REGISTRY: PluginRegistry = { stateBackends: new Map() };

/** One backend name claimed by one plugin, flattened for conflict checks. */
interface BackendClaim extends StateBackendDeclaration {
	/** Module specifier of the plugin that claimed the name. */
	readonly specifier: string;
}

/** One claim paired with every claim that precedes it. */
interface ClaimInContext {
	/** The claim being resolved. */
	readonly claim: BackendClaim;
	/** Claims made before this one, in declaration order. */
	readonly earlier: ReadonlyArray<BackendClaim>;
}

/** The `ConfigError` arm reporting a contested **Backend** name. */
type StateBackendConflict = Extract<ConfigError, { kind: "stateBackendConflict" }>;

/**
 * Collect what every loaded plugin declares into one registry, rejecting
 * any **Backend** name claimed more than once.
 *
 * Name resolution is exclusive: a name claimed by two plugins, or by a
 * plugin and a builtin, is an error naming both claimants rather than a
 * silent override. Shadowing the state backend is how a deploy runs
 * against a different store than the operator intended.
 *
 * @since unreleased
 *
 * @param plugins - Loaded plugins in the order the config listed them.
 * @returns `Ok` with the registry, or `Err` with the `stateBackendConflict`
 * error naming the contested backend and both claimants.
 * @example
 *
 * ```ts
 * import { buildPluginRegistry } from "@bedrock-rbx/core";
 *
 * import { type } from "arktype";
 *
 * const registry = buildPluginRegistry([
 *     {
 *         plugin: { stateBackends: [{ name: "s3", schema: type({ bucket: "string > 0" }) }] },
 *         specifier: "@example/state-s3",
 *     },
 * ]);
 *
 * expect(registry.success).toBeTrue();
 * if (registry.success) {
 *     expect(registry.data.stateBackends.has("s3")).toBeTrue();
 * }
 * ```
 */
export function buildPluginRegistry(
	plugins: ReadonlyArray<LoadedPlugin>,
): Result<PluginRegistry, StateBackendConflict> {
	const claims = plugins.flatMap(({ plugin, specifier }) => {
		return (plugin.stateBackends ?? []).map((declaration) => ({ ...declaration, specifier }));
	});

	const conflict = findConflict(claims);
	if (conflict !== undefined) {
		return { err: conflict, success: false };
	}

	return {
		data: { stateBackends: new Map(claims.map((claim) => [claim.name, claim.schema])) },
		success: true,
	};
}

/**
 * Report the conflict one claim produces, if any. Core holds every builtin
 * name; otherwise the earliest plugin that claimed the name holds it.
 *
 * @param input - The claim to resolve and the claims that precede it.
 * @returns The conflict error, or `undefined` when the name is free.
 */
function conflictAt({ claim, earlier }: ClaimInContext): StateBackendConflict | undefined {
	const holder = BUILTIN_STATE_BACKENDS.has(claim.name)
		? BUILTIN_SPECIFIER
		: earlier.find((other) => other.name === claim.name)?.specifier;
	if (holder === undefined) {
		return undefined;
	}

	return {
		backend: claim.name,
		kind: "stateBackendConflict",
		specifiers: [holder, claim.specifier],
	};
}

/**
 * Find the first claim landing on a name something already holds, reading
 * the claim list in the order the config listed the plugins.
 *
 * @param claims - Every backend claim, flattened across the loaded plugins.
 * @returns The conflict error, or `undefined` when every name is unique.
 */
function findConflict(claims: ReadonlyArray<BackendClaim>): StateBackendConflict | undefined {
	return claims
		.map((claim, index) => conflictAt({ claim, earlier: claims.slice(0, index) }))
		.find((conflict) => conflict !== undefined);
}
