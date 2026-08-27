import { EMPTY_PLUGIN_REGISTRY, type PluginRegistry } from "./plugin-registry.ts";
import { isGistStateConfig, type StateConfig } from "./schema.ts";

/**
 * The exclusion in force around a **Deploy**: `"exclusive"` when a hold is
 * taken on the **Environment** before anything is applied, `"disabled"`
 * when the **Backend** would have taken one and the config turned locking
 * off, `"none"` when the **Backend** offers none to begin with.
 *
 * `"disabled"` is told apart from `"none"` so a deploy running without
 * exclusion says which of the two it is: one is a choice the operator made
 * and can unmake, and the other is the **Backend** they picked.
 *
 * @since unreleased
 */
export type StateLockingCapability = "disabled" | "exclusive" | "none";

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
 * @returns `"exclusive"` when the **Backend** locks and the config left it
 * on, `"disabled"` when the config turned it off, `"none"` when the
 * **Backend** offers no exclusion.
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
	if (registered?.declaration.createLockPort === undefined) {
		return "none";
	}

	// Locking is on for a **Backend** that offers it unless the config says
	// otherwise, so only an explicit `false` opts out.
	return stateConfig.locking === false ? "disabled" : "exclusive";
}
