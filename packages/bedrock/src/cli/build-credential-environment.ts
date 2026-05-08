import process from "node:process";

import type { CommonOptions } from "./parse-options.ts";

type CredentialFlags = Pick<CommonOptions, "apiKey" | "githubToken">;

/**
 * Build a `getEnv` that overlays credential CLI flag values onto a fallback
 * environment-variable reader. Used by `bedrock deploy` and `bedrock diff`
 * to thread `--api-key` and `--github-token` into the shell's `getEnv` seam
 * without depending on `process.env` directly. Holds the canonical mapping
 * `--api-key` to `BEDROCK_API_KEY` and `--github-token` to `GITHUB_TOKEN`.
 *
 * @param parsed - Parsed common options carrying optional credential values.
 * @param fallback - Reader consulted for any variable not in the credential
 *   mapping, and for credential variables when the corresponding flag was
 *   not supplied. Defaults to `process.env[name]`.
 * @returns A `(name) => value | undefined` function suitable for the
 *   `getEnv` slot on `deploy()` / `previewDiff()`.
 */
export function buildCredentialEnvironment(
	parsed: CredentialFlags,
	fallback: (name: string) => string | undefined = readProcessEnvironment,
): (name: string) => string | undefined {
	return (name) => {
		if (name === "BEDROCK_API_KEY" && parsed.apiKey !== undefined) {
			return parsed.apiKey;
		}

		if (name === "GITHUB_TOKEN" && parsed.githubToken !== undefined) {
			return parsed.githubToken;
		}

		return fallback(name);
	};
}

function readProcessEnvironment(name: string): string | undefined {
	return process.env[name];
}
