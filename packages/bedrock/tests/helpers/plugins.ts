import type { StateBackendDeclaration } from "#src/core/plugin";
import type { PluginRegistry, RegisteredStateBackend } from "#src/core/plugin-registry";

/** One plugin-declared **Backend** plus the specifier that claimed it. */
type FakeStateBackend = StateBackendDeclaration & { readonly specifier: string };

/**
 * Build a `PluginRegistry` holding the supplied **Backend** declarations, so
 * a test states what plugins contributed without running a config load.
 *
 * @param backends - Declarations to register, each with its specifier.
 * @returns A registry the shell reads exactly as it reads a real one.
 */
export function fakeStateBackendPlugins(
	...backends: ReadonlyArray<FakeStateBackend>
): PluginRegistry {
	return {
		stateBackends: new Map<string, RegisteredStateBackend>(
			backends.map(({ specifier, ...declaration }) => {
				return [declaration.name, { declaration, specifier }];
			}),
		),
	};
}
