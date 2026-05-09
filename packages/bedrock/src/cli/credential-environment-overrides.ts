/** Credential flags that may be supplied on the CLI and translated to env-var overrides. */
interface CredentialFlags {
	/** Roblox Open Cloud API key override; translates to BEDROCK_API_KEY when defined. */
	readonly apiKey?: string;
	/** GitHub token override; translates to GITHUB_TOKEN when defined. */
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
		overrides["GITHUB_TOKEN"] = flags.githubToken;
	}

	return overrides;
}
