import { EMPTY_PLUGIN_REGISTRY, type PluginRegistry } from "./plugin-registry.ts";
import { isGistStateConfig, type StateConfig } from "./schema.ts";

/**
 * The exclusion a **Backend** provides around a **Deploy**: `"exclusive"`
 * when it takes a hold on the **Environment** before anything is applied,
 * `"none"` when concurrent deploys are the operator's problem to serialize.
 *
 * @since unreleased
 */
export type StateLockingCapability = "exclusive" | "none";

/** Inputs for {@link stateLockingCapabilityOf}. */
interface StateLockingInputs {
	/**
	 * What the loaded plugins declared. Omit it when no plugins are loaded;
	 * a `state.backend` naming one of their **Backend**s reports what that
	 * **Backend** claimed.
	 */
	readonly plugins?: PluginRegistry | undefined;
	/** Resolved state configuration for the target environment. */
	readonly stateConfig: StateConfig;
}

/**
 * Report the exclusion the configured **Backend** provides, so the CLI can
 * surface which guarantee applies before a deploy relies on it.
 *
 * Locking is declared, never inferred from a probe at deploy time: the
 * point of declaring it is that a user choosing where **State** lives sees
 * the difference then, rather than discovering it during an incident.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { stateLockingCapabilityOf } from "@bedrock-rbx/core";
 *
 * const capability = stateLockingCapabilityOf({
 *     stateConfig: { backend: "gist", gistId: "abc123" },
 * });
 *
 * expect(capability).toBe("none");
 * ```
 *
 * @param inputs - The resolved `state` block plus what the loaded plugins
 * declared.
 * @returns `"exclusive"` when the **Backend** locks, `"none"` otherwise.
 */
export function stateLockingCapabilityOf({
	plugins,
	stateConfig,
}: StateLockingInputs): StateLockingCapability {
	// Builtin names resolve to their builtin adapter even when a plugin
	// claims one, matching how the **Backend** itself is dispatched; the gist
	// **Backend** cannot offer atomic create-if-absent and claims no locking.
	if (isGistStateConfig(stateConfig)) {
		return "none";
	}

	const registered = (plugins ?? EMPTY_PLUGIN_REGISTRY).stateBackends.get(stateConfig.backend);
	return registered?.declaration.createLockPort === undefined ? "none" : "exclusive";
}
