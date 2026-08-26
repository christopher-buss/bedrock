import type { StateBackendDeclaration } from "#src/core/plugin";
import type { PluginRegistry, RegisteredStateBackend } from "#src/core/plugin-registry";

/**
 * One plugin-declared **Backend** plus the specifier that claimed it.
 *
 * @template TState - Shape the declaration's schema validates into.
 */
type FakeStateBackend<TState extends object> = StateBackendDeclaration<TState> & {
	/** Module specifier the registry reports as the claimant. */
	readonly specifier: string;
};

/**
 * Build a `PluginRegistry` holding one **Backend** declaration, so a test
 * states what a plugin contributed without running a config load.
 *
 * @template TState - Shape the declaration's schema validates a `state`
 * block into, inferred from the schema so the builder reads its own keys.
 *
 * @param backend - The declaration to register, plus its specifier.
 * @returns A registry the shell reads exactly as it reads a real one.
 */
export function fakeStateBackendPlugins<TState extends object>({
	specifier,
	...declaration
}: FakeStateBackend<TState>): PluginRegistry {
	const registered: RegisteredStateBackend = { declaration, specifier };
	return { stateBackends: new Map([[declaration.name, registered]]) };
}

/**
 * Combine registries so a test can state what several plugins declared
 * while each declaration keeps the type its own schema gave it.
 *
 * @param registries - The registries to combine, in declaration order.
 * @returns One registry holding every **Backend** they registered.
 * @throws When two registries claim the same **Backend** name, which a
 * real config load would have rejected.
 */
export function mergeStateBackendPlugins(
	...registries: ReadonlyArray<PluginRegistry>
): PluginRegistry {
	const entries = registries.flatMap((registry) => [...registry.stateBackends]);
	const merged = new Map(entries);
	if (merged.size !== entries.length) {
		// A real load rejects a contested name, so a test that reaches
		// here is asserting against a registry that could not exist.
		throw new Error("mergeStateBackendPlugins: two registries claim one backend name");
	}

	return { stateBackends: merged };
}
