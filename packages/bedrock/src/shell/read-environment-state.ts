import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import type { PluginRegistry } from "../core/plugin-registry.ts";
import { resolveStateConfig } from "../core/resolve-state-config.ts";
import type { Config } from "../core/schema.ts";
import type { StatePort } from "../ports/state-port.ts";
import { buildStatePort } from "./build-state-port.ts";

interface StateReaderInputs {
	readonly config: Config;
	readonly fetch?: GistFetch | undefined;
	readonly getEnv: (name: string) => string | undefined;
	readonly plugins: PluginRegistry;
	readonly statePort?: StatePort | undefined;
}

/**
 * Resolve each environment's backend; an injected port serves all
 * environments.
 * @param inputs - Authored backend config, plugins and optional port override.
 * @returns A reader resolving the backend configured for each environment.
 */
export function createEnvironmentStateReader(inputs: StateReaderInputs): StatePort["read"] {
	const reads = new Map<string, ReturnType<StatePort["read"]>>();
	return async (environment) => {
		const cached = reads.get(environment);
		if (cached !== undefined) {
			return cached;
		}

		const read = readEnvironmentStateAsync(inputs, environment);
		reads.set(environment, read);
		return read;
	};
}

async function readEnvironmentStateAsync(
	inputs: StateReaderInputs,
	environment: string,
): ReturnType<StatePort["read"]> {
	if (inputs.statePort !== undefined) {
		return inputs.statePort.read(environment);
	}

	const stateConfig = resolveStateConfig(inputs.config, environment);
	const port = stateConfig.success
		? buildStatePort({ ...inputs, stateConfig: stateConfig.data })
		: stateConfig;
	if (!port.success) {
		return {
			err: {
				file: environment,
				kind: "stateError",
				reason: `Cannot read environment state: ${port.err.kind}`,
			},
			success: false,
		};
	}

	return port.data.read(environment);
}
