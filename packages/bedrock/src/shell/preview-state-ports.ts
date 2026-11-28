import type { Result } from "@bedrock-rbx/ocale";

import type { PluginRegistry } from "../core/plugin-registry.ts";
import { resolveStateConfig, type StateNotConfiguredError } from "../core/resolve-state-config.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { StateLockPort } from "../ports/state-lock-port.ts";
import type { StatePort } from "../ports/state-port.ts";
import {
	buildStateBackend,
	type MissingCredentialError,
	type PluginStateBackendError,
	type UnsupportedBackendError,
} from "./build-state-port.ts";
import type { PreviewDiffOptions } from "./preview-diff.ts";
import { getEnvironmentOf } from "./preview-live-registry.ts";

/** The **Backend** ports one preview reads through. */
export interface PreviewStatePorts {
	/**
	 * Exclusion the **Backend** provides, asked so a preview racing a
	 * deploy says so, and absent when the **Backend** provides none.
	 */
	readonly stateLockPort: StateLockPort | undefined;
	/** Persistence the prior snapshot is read from. */
	readonly statePort: StatePort;
}

/** The preview options that pick its **Backend**. */
type PreviewStatePortOptions = Pick<
	PreviewDiffOptions,
	"environment" | "fetch" | "getEnv" | "stateLockPort" | "statePort"
>;

/** Why the preview's **Backend** could not be built. */
type PreviewStatePortError =
	| MissingCredentialError
	| PluginStateBackendError
	| StateNotConfiguredError
	| UnsupportedBackendError;

/**
 * Pick the **Backend** ports a preview reads through: the caller's, or the
 * ones its config names.
 *
 * @param options - The caller's preview options.
 * @param project - The Environment config and the loaded plugin registry.
 * @returns The ports, or why the configured **Backend** could not be built.
 */
export function pickStatePorts(
	options: PreviewStatePortOptions,
	{ config, plugins }: { readonly config: ResolvedConfig; readonly plugins: PluginRegistry },
): Result<PreviewStatePorts, PreviewStatePortError> {
	if (options.statePort !== undefined) {
		return {
			data: { stateLockPort: options.stateLockPort, statePort: options.statePort },
			success: true,
		};
	}

	const stateConfig = resolveStateConfig(config, options.environment);
	if (!stateConfig.success) {
		return { err: stateConfig.err, success: false };
	}

	const backend = buildStateBackend({
		fetch: options.fetch,
		getEnv: getEnvironmentOf(options),
		plugins,
		stateConfig: stateConfig.data,
	});
	if (!backend.success) {
		return backend;
	}

	return {
		data: backend.data,
		success: true,
	};
}
