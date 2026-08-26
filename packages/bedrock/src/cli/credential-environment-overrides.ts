import process from "node:process";

/**
 * Credential flags that may be supplied on the CLI and translated to env-var
 * overrides.
 */
interface CredentialFlags {
	/**
	 * Roblox Open Cloud API key override; translates to BEDROCK_API_KEY when
	 * defined.
	 */
	readonly apiKey?: string;
	/**
	 * GitHub token override; translates to BEDROCK_GITHUB_TOKEN when defined.
	 */
	readonly githubToken?: string;
}

/**
 * Map CLI credential flags to their corresponding env-var names, omitting
 * entries whose flag is `undefined`.
 * @param flags - CLI credential flag values to translate.
 * @returns An immutable record of env-var names to their override values.
 */
export function buildCredentialOverrides(flags: CredentialFlags): Readonly<Record<string, string>> {
	const overrides: Record<string, string> = {};
	if (flags.apiKey !== undefined) {
		overrides["BEDROCK_API_KEY"] = flags.apiKey;
	}

	if (flags.githubToken !== undefined) {
		overrides["BEDROCK_GITHUB_TOKEN"] = flags.githubToken;
	}

	return overrides;
}

/**
 * Build the environment-variable reader a command hands to the pipeline it
 * dispatches: a credential flag wins over the process environment, and
 * everything else reads straight through.
 *
 * @param flags - CLI credential flag values to translate.
 * @returns A reader answering from the flags first, `process.env` second.
 */
export function buildEnvironmentReader(
	flags: CredentialFlags,
): (name: string) => string | undefined {
	const overrides = buildCredentialOverrides(flags);
	return (name) => overrides[name] ?? process.env[name];
}
