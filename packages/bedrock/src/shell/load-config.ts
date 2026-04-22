import type { Result } from "@bedrock/ocale";

import { loadConfig as c12LoadConfig } from "c12";
import process from "node:process";

import type { ConfigError } from "../core/config-error.ts";
import { type Config, validateConfig } from "../core/schema.ts";

/**
 * Options for {@link loadConfig}. Matches a subset of c12's loader options;
 * additional fields land with the issues that introduce each flow.
 */
export interface LoadConfigOptions {
	/**
	 * Directory to search from. Defaults to `process.cwd()` at call time, so
	 * each invocation sees the current working directory.
	 */
	readonly cwd?: string;
}

/**
 * Discover, parse, and validate the project config.
 *
 * Looks for `bedrock.config.{ts,js,mjs,cjs,yaml,yml,json}`, `.bedrockrc*`,
 * and `package.json#bedrock` starting at `options.cwd` (or the current
 * working directory). Returns a fresh, mutable `Config` on every call so
 * long-running scripts see up-to-date values.
 *
 * Errors return via `Result`:
 * - `fileNotFound` - no config file was discovered under the search path.
 * - `validationFailed` - a file was found and parsed, but its content did
 *   not satisfy the runtime schema.
 *
 * @param options - Loader options (currently just `cwd`).
 * @returns `Ok` with the validated `Config`, or `Err` with a `ConfigError`.
 * @example
 *
 * ```ts
 * import { loadConfig } from "bedrock";
 *
 * return loadConfig({ cwd: "/path/that/does/not/have/a/config" }).then((result) => {
 *     expect(result.success).toBeFalse();
 *     if (!result.success) {
 *         expect(result.err.kind).toBe("fileNotFound");
 *     }
 * });
 * ```
 */
export async function loadConfig(
	options?: LoadConfigOptions,
): Promise<Result<Config, ConfigError>> {
	const cwd = options?.cwd ?? process.cwd();
	const resolved = await c12LoadConfig<Record<string, unknown>>({ name: "bedrock", cwd });

	if (resolved._configFile === undefined) {
		return {
			err: { kind: "fileNotFound", searchedFrom: cwd },
			success: false,
		};
	}

	return validateConfig(resolved.config, resolved._configFile);
}
