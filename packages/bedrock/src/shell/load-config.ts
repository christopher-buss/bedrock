import type { Result } from "@bedrock/ocale";

import { loadConfig as c12LoadConfig } from "c12";
import { readdirSync } from "node:fs";
import { join } from "node:path";
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
 * When the exported default is a function (sync or async), `loadConfig`
 * invokes it with an empty `ConfigContext` and awaits the result before
 * validating.
 *
 * Errors return via `Result`:
 * - `fileNotFound` - no config file was discovered under the search path.
 * - `parseFailed` - a config file was found but could not be parsed (for
 *   example, malformed YAML or JSON).
 * - `validationFailed` - a file was found and parsed, but its content did
 *   not satisfy the runtime schema.
 * - `configFunctionFailed` - a function-form config threw or its returned
 *   promise rejected while being invoked.
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

	let resolved: Awaited<ReturnType<typeof c12LoadConfig<Record<string, unknown>>>>;
	try {
		resolved = await c12LoadConfig<Record<string, unknown>>({ name: "bedrock", cwd });
	} catch (err) {
		const sourceFile = discoverConfigFile(cwd);
		return { err: attributeLoadError(err, { cwd, sourceFile }), success: false };
	}

	if (resolved._configFile === undefined) {
		return {
			err: { kind: "fileNotFound", searchedFrom: cwd },
			success: false,
		};
	}

	return validateConfig(resolved.config, resolved._configFile);
}

function stackHasUserFrame(stack: string | undefined, sourceFile: string): boolean {
	if (stack === undefined) {
		return false;
	}

	return stack
		.split("\n")
		.some((line) => line.trimStart().startsWith("at ") && line.includes(sourceFile));
}

function attributeLoadError(
	err: unknown,
	location: { cwd: string; sourceFile: string | undefined },
): ConfigError {
	const { cwd, sourceFile } = location;
	const message = err instanceof Error ? err.message : String(err);
	if (
		sourceFile !== undefined &&
		err instanceof Error &&
		stackHasUserFrame(err.stack, sourceFile)
	) {
		return { kind: "configFunctionFailed", message, sourceFile };
	}

	return { kind: "parseFailed", message, sourceFile: sourceFile ?? cwd };
}

function discoverConfigFile(cwd: string): string | undefined {
	let entries: ReadonlyArray<string>;
	try {
		entries = readdirSync(cwd);
	} catch {
		return undefined;
	}

	const match = entries.toSorted().find((entry) => entry.startsWith("bedrock.config."));
	return match === undefined ? undefined : join(cwd, match);
}
