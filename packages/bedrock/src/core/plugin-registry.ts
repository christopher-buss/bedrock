import type { Result } from "@bedrock-rbx/ocale";

import type { ConfigError } from "./config-error.ts";
import type { BedrockPlugin, StateBackendDeclaration } from "./plugin.ts";
import type { BuiltinStateBackend } from "./schema.ts";

/**
 * Module specifier core reports as the claimant of a builtin **Backend**
 * name, so a collision with a builtin reads the same as a collision
 * between two plugins.
 */
const BUILTIN_SPECIFIER = "@bedrock-rbx/core";

// **Backend** names core ships, which no plugin may claim. Keyed by name
// and checked against `BuiltinStateBackend` so core gaining a backend
// without claiming its name here fails to compile, rather than leaving the
// name free for a plugin to take.
const BUILTIN_STATE_BACKENDS = { gist: true } satisfies Record<BuiltinStateBackend, true>;

/**
 * One plugin module that imported successfully, paired with the specifier
 * the config named it by.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 */
export interface LoadedPlugin {
	/** The plugin object the module default-exported. */
	readonly plugin: BedrockPlugin;
	/** Module specifier the config listed under `plugins`. */
	readonly specifier: string;
}

/**
 * One plugin-declared **Backend**, paired with the specifier that claimed
 * its name so a failure it produces can name the plugin responsible.
 *
 * @since 0.2.0
 */
export interface RegisteredStateBackend {
	/** What the plugin declared for this **Backend**. */
	readonly declaration: StateBackendDeclaration;
	/** Module specifier of the plugin that claimed the name. */
	readonly specifier: string;
}

/**
 * What the loaded plugins collectively contribute, resolved once per
 * config load and read wherever a plugin's declaration is needed.
 *
 * @since 0.2.0
 */
export interface PluginRegistry {
	/** Each plugin-declared **Backend**, keyed by the name it claimed. */
	readonly stateBackends: ReadonlyMap<string, RegisteredStateBackend>;
}

/**
 * The registry a config load with no plugins produces.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 */
export const EMPTY_PLUGIN_REGISTRY: PluginRegistry = { stateBackends: new Map() };

/** One backend name claimed by one plugin, flattened for conflict checks. */
interface BackendClaim extends StateBackendDeclaration {
	/** Module specifier of the plugin that claimed the name. */
	readonly specifier: string;
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
 * Internal seam: not re-exported from `src/index.ts`.
 *
 * @param plugins - Loaded plugins in the order the config listed them.
 * @returns `Ok` with the registry, or `Err` with the `stateBackendConflict`
 * error naming the contested backend and both claimants.
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
		data: {
			stateBackends: new Map(
				claims.map(({ specifier, ...declaration }) => {
					return [declaration.name, { declaration, specifier }];
				}),
			),
		},
		success: true,
	};
}

/**
 * Report the conflict one claim produces, if any. Core holds every builtin
 * name; otherwise the earliest claim on the name holds it.
 *
 * @param claim - The claim being resolved.
 * @param earlier - Claims made before this one, in declaration order.
 * @returns The conflict error, or `undefined` when the name is free.
 */
function conflictAt(
	claim: BackendClaim,
	earlier: ReadonlyArray<BackendClaim>,
): StateBackendConflict | undefined {
	const holder = Object.hasOwn(BUILTIN_STATE_BACKENDS, claim.name)
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
 * Report the earliest claim landing on a name something already holds,
 * reading the claim list in the order the config listed the plugins.
 *
 * @param claims - Every backend claim, flattened across the loaded plugins.
 * @returns The conflict error, or `undefined` when every name is unique.
 */
function findConflict(claims: ReadonlyArray<BackendClaim>): StateBackendConflict | undefined {
	return claims
		.map((claim, index) => conflictAt(claim, claims.slice(0, index)))
		.find((conflict) => conflict !== undefined);
}
