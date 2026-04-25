import type { Result } from "@bedrock/ocale";

import { loadConfig as c12LoadConfig } from "c12";
import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import process from "node:process";

import type { ConfigError } from "../core/config-error.ts";
import { type Config, validateConfig } from "../core/schema.ts";

/**
 * Options for {@link loadConfig}. Matches a subset of c12's loader options;
 * additional fields land with the issues that introduce each flow.
 */
export interface LoadConfigOptions {
	/**
	 * Path to a specific config file to load, including its extension.
	 * Resolved relative to `cwd` when not absolute. Loaded as-is with no
	 * extension search; if the file does not exist at the given path,
	 * `loadConfig` returns `fileNotFound`. When omitted, `loadConfig`
	 * discovers `bedrock.config.{ts,js,...}` from `cwd`.
	 */
	readonly configFile?: string;
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
 * @param options - Loader options.
 * @returns `Ok` with the validated `Config`, or `Err` with a `ConfigError`.
 * @example
 *
 * ```ts
 * import { loadConfig } from "@bedrock/core";
 *
 * return loadConfig({
 *     configFile: "bedrock.staging.config.yaml",
 *     cwd: "/path/that/does/not/have/a/config",
 * }).then((result) => {
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
	const configFile =
		options?.configFile === undefined ? undefined : resolveConfigPath(cwd, options.configFile);
	if (configFile !== undefined && !isExistingFile(configFile)) {
		return { err: { kind: "fileNotFound", searchedFrom: cwd }, success: false };
	}

	let resolved: Awaited<ReturnType<typeof c12LoadConfig<Record<string, unknown>>>>;
	try {
		resolved = await c12LoadConfig<Record<string, unknown>>({
			name: "bedrock",
			cwd,
			...(configFile === undefined ? {} : { configFile }),
		});
	} catch (err) {
		return { err: attributeLoadError(err, cwd), success: false };
	}

	if (resolved._configFile === undefined) {
		return { err: { kind: "fileNotFound", searchedFrom: cwd }, success: false };
	}

	return validateConfig(resolved.config, resolved._configFile);
}

function resolveConfigPath(cwd: string, configFile: string): string {
	return isAbsolute(configFile) ? configFile : join(cwd, configFile);
}

function isExistingFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

const CONFIG_FILE_IN_FRAME = /[^\s():"']*bedrock\.config\.(?:ts|js|mjs|cjs|yaml|yml|json)/;

function extractConfigFileFromStack(err: unknown): string | undefined {
	if (!(err instanceof Error) || err.stack === undefined) {
		return undefined;
	}

	for (const rawLine of err.stack.split("\n")) {
		const line = rawLine.trimStart();
		if (!line.startsWith("at ")) {
			continue;
		}

		const match = CONFIG_FILE_IN_FRAME.exec(line);
		if (match !== null) {
			return match[0];
		}
	}

	return undefined;
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

function attributeLoadError(err: unknown, cwd: string): ConfigError {
	const message = err instanceof Error ? err.message : String(err);
	const frameFile = extractConfigFileFromStack(err);
	if (frameFile !== undefined) {
		return { kind: "configFunctionFailed", message, sourceFile: frameFile };
	}

	return { kind: "parseFailed", message, sourceFile: discoverConfigFile(cwd) ?? cwd };
}
