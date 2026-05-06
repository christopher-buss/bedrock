import type { Result } from "@bedrock-rbx/ocale";

import process from "node:process";

/**
 * Failure modes returned by {@link getEnvironment}.
 */
export type GetEnvironmentError =
	| { readonly kind: "missingEnvironment" }
	| { readonly kind: "multipleEnvironments"; readonly values: ReadonlyArray<string> };

/**
 * Resolve the deploy environment for an override script invocation.
 *
 * Reads `--env <name>` from the supplied argv first, falls back to
 * `BEDROCK_ENVIRONMENT` from the supplied env reader. Returns
 * `missingEnvironment` when neither is present and `multipleEnvironments`
 * (with every offending value) when argv contains more than one `--env`
 * flag. Both inputs default to the running process so override scripts
 * under `.bedrock/` can call `getEnvironment()` with no arguments.
 *
 * @param argv - Argument list to scan for `--env <name>` flags. Defaults to
 * `process.argv.slice(2)` when omitted.
 * @param readEnvironment - Reads an environment variable; consulted as a
 * fallback when no `--env` flag is present. Defaults to a `process.env`
 * reader when omitted.
 * @returns `Ok(environment)` on success, `Err(GetEnvironmentError)` otherwise.
 * @example
 *
 * ```ts
 * import { getEnvironment } from "@bedrock-rbx/core";
 *
 * const result = getEnvironment(["--env", "production"], () => undefined);
 *
 * expect(result.success).toBeTrue();
 * if (result.success) {
 *     expect(result.data).toBe("production");
 * }
 * ```
 */
export function getEnvironment(
	argv?: ReadonlyArray<string>,
	readEnvironment: (name: string) => string | undefined = readProcessEnvironment,
): Result<string, GetEnvironmentError> {
	const tokens = argv ?? process.argv.slice(2);
	const flagged = collectFlagValues(tokens);
	if (flagged.length > 1) {
		return { err: { kind: "multipleEnvironments", values: flagged }, success: false };
	}

	const value = flagged[0] ?? readEnvironment("BEDROCK_ENVIRONMENT");
	if (value === undefined) {
		return { err: { kind: "missingEnvironment" }, success: false };
	}

	return { data: value, success: true };
}

function collectFlagValues(argv: ReadonlyArray<string>): ReadonlyArray<string> {
	return argv.flatMap((token, index) => {
		if (token !== "--env") {
			return [];
		}

		const next = argv[index + 1];
		return next === undefined ? [] : [next];
	});
}

function readProcessEnvironment(name: string): string | undefined {
	return process.env[name];
}
