import type { Result } from "@bedrock-rbx/ocale";

import { loadConfig as c12LoadConfig } from "c12";
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import process from "node:process";

import {
	createLuteLuauEvaluator,
	LuauRuntimeMissingError,
} from "../adapters/lute-luau-evaluator.ts";
import type { ConfigError } from "../core/config-error.ts";
import { type Config, validateConfig } from "../core/schema.ts";
import type { LuauEvaluator } from "../ports/luau-evaluator.ts";

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
 * Internal dependencies for {@link loadConfigWith}. Not re-exported from
 * `src/index.ts` — the only consumer is the unit spec, which injects a fake
 * evaluator to exercise error paths without spawning a real process.
 */
export interface LoadConfigDeps {
	/** Function used to evaluate `.luau` config files into plain config objects. */
	readonly evaluator: LuauEvaluator;
}

interface LuauResolveResult {
	/* eslint-disable-next-line flawless/naming-convention -- c12 reads `_configFile` to detect that a config file was found. */
	readonly _configFile: string;
	readonly config: Record<string, unknown>;
	readonly configFile: string;
	readonly cwd: string;
}

/**
 * Internal entrypoint that lets tests inject a fake `LuauEvaluator`. The
 * public {@link loadConfig} wraps this with the real lute adapter; the rest
 * of the loader pipeline is identical.
 *
 * @param deps - Injected dependencies. Only the evaluator is configurable.
 * @param options - Same loader options accepted by {@link loadConfig}.
 * @returns Same `Result<Config, ConfigError>` shape as `loadConfig`.
 */
export async function loadConfigWith(
	deps: LoadConfigDeps,
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
			resolve: makeLuauResolver({
				callerConfigFile: configFile,
				defaultCwd: cwd,
				evaluator: deps.evaluator,
			}),
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
 * import { loadConfig } from "@bedrock-rbx/core";
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
	return loadConfigWith({ evaluator: createLuteLuauEvaluator() }, options);
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

/**
 * Resolve a c12 `resolve` source string to an absolute path of a Luau
 * config file, if one applies. Handles two shapes:
 *
 * - Explicit `.luau` paths (`extends: "./base.luau"` or absolute) - always
 *   ours when the file exists.
 * - The `"."` auto-discovery source - claim only when `bedrock.config.luau`
 *   is present in the search directory.
 *
 * Returns `undefined` for every other shape so c12 falls through to its
 * built-in resolution.
 * @param source - The c12 `resolve` source string (`"."` for auto-discovery,
 * or a relative or absolute path for explicit `extends` references).
 * @param cwd - The directory to resolve relative paths against and to search
 * for `bedrock.config.luau` in.
 * @returns The absolute path of the matched Luau config, or `undefined` to
 * defer to c12's built-in resolution.
 */
function locateLuauConfig(source: string, cwd: string): string | undefined {
	if (source.endsWith(".luau")) {
		const candidate = isAbsolute(source) ? source : resolvePath(cwd, source);
		return existsSync(candidate) ? candidate : undefined;
	}

	if (source === ".") {
		// Defer to c12's built-in resolution when a native-format config sits
		// alongside the Luau one. This matches the documented precedence:
		// TypeScript / JavaScript / JSON / YAML beat Luau when both are
		// present. Only claim the Luau file when it's the sole candidate.
		if (
			NATIVE_CONFIG_EXTENSIONS.some((extension) =>
				existsSync(join(cwd, `bedrock.config.${extension}`)),
			)
		) {
			return undefined;
		}

		const candidate = join(cwd, LUAU_CONFIG_BASENAME);
		return existsSync(candidate) ? candidate : undefined;
	}

	return undefined;
}

const NATIVE_CONFIG_EXTENSIONS = [
	"ts",
	"mts",
	"cts",
	"js",
	"mjs",
	"cjs",
	"json",
	"yaml",
	"yml",
] as const;

interface PickLuauTargetContext {
	readonly callerConfigFile: string | undefined;
	readonly cwd: string;
}

interface LuauResolverDeps {
	readonly callerConfigFile: string | undefined;
	readonly defaultCwd: string;
	readonly evaluator: LuauEvaluator;
}

/**
 * Decide which Luau file the resolver should evaluate for a given c12 source,
 * or `undefined` to defer to c12's built-in loaders.
 *
 * When the caller named a specific configFile, c12 always invokes us with
 * source === "." for the main config (and normalizes its own
 * options.configFile to "bedrock.config", so we cannot inspect it). Route
 * the explicit path through our evaluator if it points at a `.luau` file;
 * otherwise defer.
 * @param source - The c12 `resolve` source string.
 * @param context - Caller-side state: the resolved cwd to search in, and the
 * caller's configFile path (or undefined when no explicit path was supplied).
 * @returns The absolute path of the Luau file to evaluate, or `undefined`.
 */
function pickLuauTarget(source: string, context: PickLuauTargetContext): string | undefined {
	const { callerConfigFile, cwd } = context;
	if (source === "." && callerConfigFile !== undefined) {
		return callerConfigFile.endsWith(".luau") ? callerConfigFile : undefined;
	}

	return locateLuauConfig(source, cwd);
}

function makeLuauResolver(
	deps: LuauResolverDeps,
): (
	source: string,
	c12Options: { readonly cwd?: string },
) => Promise<LuauResolveResult | undefined> {
	return async (source, c12Options) => {
		const cwd = c12Options.cwd ?? deps.defaultCwd;
		const luauPath = pickLuauTarget(source, { callerConfigFile: deps.callerConfigFile, cwd });
		if (luauPath === undefined) {
			return;
		}

		const config = await deps.evaluator(luauPath);
		return {
			_configFile: luauPath,
			config,
			configFile: luauPath,
			cwd,
		};
	};
}

const LUAU_CONFIG_BASENAME = "bedrock.config.luau";

// `.luau` is intentionally absent: Luau errors travel through the evaluator
// adapter's ERR sentinel, not JS stack frames, so the file path is attributed
// by `discoverConfigFile` rather than scraped from the throw site.
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
	if (err instanceof LuauRuntimeMissingError) {
		return { hint: err.hint, kind: "luauRuntimeMissing", sourceFile: err.sourceFile };
	}

	const message = err instanceof Error ? err.message : String(err);
	const frameFile = extractConfigFileFromStack(err);
	if (frameFile !== undefined) {
		return { kind: "configFunctionFailed", message, sourceFile: frameFile };
	}

	return { kind: "parseFailed", message, sourceFile: discoverConfigFile(cwd) ?? cwd };
}
