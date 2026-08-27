import type { Result } from "@bedrock-rbx/ocale";

import process from "node:process";

import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import type { PluginRegistry } from "../core/plugin-registry.ts";
import { resolveStateConfig, type StateNotConfiguredError } from "../core/resolve-state-config.ts";
import type { Config } from "../core/schema.ts";
import type { StateLockingCapability } from "../core/state-locking.ts";
import type { StateLockError, StateLockHolding } from "../ports/state-lock-port.ts";
import {
	buildStateLockPort,
	type PluginStateBackendError,
	type UnsupportedBackendError,
} from "./build-state-port.ts";

/**
 * Inputs for {@link forceReleaseStateLockAsync}.
 *
 * @since unreleased
 */
export interface ForceReleaseStateLockOptions {
	/** Validated project config, whose `state` block names the **Backend**. */
	readonly config: Config;
	/** **Environment** whose hold is being taken away. */
	readonly environment: string;
	/** `fetch` override plumbed into a default-constructed adapter. */
	readonly fetch?: GistFetch;
	/**
	 * Reads an environment variable; defaults to `(name) =>
	 * process.env[name]`.
	 */
	readonly getEnv?: (name: string) => string | undefined;
	/**
	 * What the loaded plugins declared, which decides the **Backend**s
	 * `config.state.backend` can name beyond the builtins.
	 */
	readonly plugins?: PluginRegistry;
}

/**
 * What one force release did.
 *
 * @since unreleased
 */
export interface ForceReleaseStateLockOutcome {
	/**
	 * Who held the **Environment** until this release took it away, absent
	 * when nothing held it and when no hold was in force to take away.
	 */
	readonly displaced: StateLockHolding | undefined;
	/** **Environment** the release was asked for. */
	readonly environment: string;
	/**
	 * The exclusion that was in force. Anything but `"exclusive"` means
	 * nothing was taken away, because nothing was holding the
	 * **Environment** on bedrock's account to begin with.
	 */
	readonly locking: StateLockingCapability;
}

/**
 * Failure surfaced by {@link forceReleaseStateLockAsync}: the **Backend**
 * could not be built for this **Environment**, or the hold could not be
 * taken away.
 *
 * @since unreleased
 */
export type ForceReleaseStateLockError =
	| PluginStateBackendError
	| StateNotConfiguredError
	| UnsupportedBackendError
	| { readonly cause: StateLockError; readonly kind: "lockReleaseFailed" };

/**
 * Take one **Environment**'s hold away, whoever holds it.
 *
 * This is the escape hatch locking cannot ship without. A **Deploy** whose
 * process was killed between taking a hold and giving it up leaves one
 * behind, and on a **Backend** that leases its holds that hold expires on
 * its own; until it does, and on any **Backend** where it does not, an
 * operator needs a way to say the run holding this is gone.
 *
 * Taking a hold away does not make the displaced run safe to keep running:
 * what makes takeover safe is that the **State** write is guarded on the
 * record that was read, so a holder that kept running fails its write
 * rather than overwriting whatever the next run recorded.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { forceReleaseStateLockAsync } from "@bedrock-rbx/core";
 *
 * return forceReleaseStateLockAsync({
 *     config: {
 *         environments: { production: {} },
 *         state: { backend: "gist", gistId: "abc123" },
 *     },
 *     environment: "production",
 *     getEnv: () => "ghp_example",
 * }).then((released) => {
 *     expect(released.success).toBeTrue();
 *     if (released.success) {
 *         // The gist **Backend** takes no hold, so there is none to take away.
 *         expect(released.data.locking).toBe("none");
 *     }
 * });
 * ```
 *
 * @param options - The **Environment** to release, the config naming its
 * **Backend**, and the credential and transport seams.
 * @returns What the release displaced, or why it could not be done.
 */
export async function forceReleaseStateLockAsync(
	options: ForceReleaseStateLockOptions,
): Promise<Result<ForceReleaseStateLockOutcome, ForceReleaseStateLockError>> {
	const stateConfig = resolveStateConfig(options.config, options.environment);
	if (!stateConfig.success) {
		return { err: stateConfig.err, success: false };
	}

	// Only the exclusion is built, so an operator is told a **Backend**
	// takes no hold rather than told to go and find the credential
	// persistence would have needed.
	const exclusion = buildStateLockPort({
		fetch: options.fetch,
		getEnv: options.getEnv ?? readProcessEnvironment,
		plugins: options.plugins,
		stateConfig: stateConfig.data,
	});
	if (!exclusion.success) {
		return exclusion;
	}

	const { locking, stateLockPort } = exclusion.data;
	if (stateLockPort === undefined) {
		return {
			data: { displaced: undefined, environment: options.environment, locking },
			success: true,
		};
	}

	const released = await stateLockPort.forceRelease(options.environment);
	return released.success
		? {
				data: { displaced: released.data, environment: options.environment, locking },
				success: true,
			}
		: { err: { cause: released.err, kind: "lockReleaseFailed" }, success: false };
}

function readProcessEnvironment(name: string): string | undefined {
	return process.env[name];
}
