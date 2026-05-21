import type { OverrideInvocation } from "./dispatch-override.ts";
import type { CommonOptions } from "./parse-options.ts";

/**
 * Inputs the CLI's deploy dispatcher hands to {@link buildOverrideInvocation}
 * once an override file has been discovered: the parsed deploy flags, the
 * absolute override path, and the environment a single invocation targets.
 */
export interface BuildOverrideInvocationInputs {
	/** Target environment for the single invocation being built. */
	readonly environment: string;
	/** Absolute path to the override script to invoke. */
	readonly overridePath: string;
	/** Parsed deploy options carrying the credential and config flags to forward. */
	readonly parsed: CommonOptions;
}

/**
 * Translate the deploy command's parsed inputs into a single-environment
 * {@link OverrideInvocation}. Optional flags (`apiKey`, `configFile`,
 * `githubToken`) are *omitted* from the returned object when their parsed
 * value is `undefined`, rather than included with an `undefined` value: the
 * spawn protocol's downstream argv and env-var routing relies on field
 * presence, not just defined-ness.
 * @param inputs - {@link BuildOverrideInvocationInputs}.
 * @returns A single-environment {@link OverrideInvocation}.
 */
export function buildOverrideInvocation(inputs: BuildOverrideInvocationInputs): OverrideInvocation {
	const { environment, overridePath, parsed } = inputs;
	return {
		...(parsed.apiKey === undefined ? {} : { apiKey: parsed.apiKey }),
		...(parsed.configFile === undefined ? {} : { configFile: parsed.configFile }),
		environment,
		...(parsed.githubToken === undefined ? {} : { githubToken: parsed.githubToken }),
		overridePath,
	};
}
