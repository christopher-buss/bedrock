import type { Result } from "@bedrock/ocale";

/**
 * Failure modes returned by {@link getEnvironment}.
 */
export type GetEnvironmentError =
	| { readonly kind: "missingEnvironment" }
	| { readonly kind: "multipleEnvironments"; readonly values: ReadonlyArray<string> };

/**
 * Resolve the deploy environment for an override script invocation.
 *
 * @param argv - Argument list to scan for `--env <name>` flags.
 * @param readEnvironment - Reads an environment variable; consulted as a
 * fallback when no `--env` flag is present.
 * @returns `Ok(environment)` on success, `Err(GetEnvironmentError)` otherwise.
 */
export function getEnvironment(
	argv: ReadonlyArray<string>,
	readEnvironment: (name: string) => string | undefined,
): Result<string, GetEnvironmentError> {
	const flagIndex = argv.indexOf("--env");
	const value = flagIndex === -1 ? readEnvironment("BEDROCK_ENVIRONMENT") : argv[flagIndex + 1];
	if (value === undefined) {
		return { err: { kind: "missingEnvironment" }, success: false };
	}

	return { data: value, success: true };
}
