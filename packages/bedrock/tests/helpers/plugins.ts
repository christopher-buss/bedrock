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
