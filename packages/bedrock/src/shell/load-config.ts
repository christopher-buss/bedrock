import type { Result } from "@bedrock/ocale";

import { loadConfig as c12LoadConfig } from "c12";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
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

interface LuauResolveResult {
	/* eslint-disable-next-line flawless/naming-convention -- c12 reads `_configFile` to detect that a config file was found. */
	readonly _configFile: string;
	readonly config: Record<string, unknown>;
	readonly configFile: string;
	readonly cwd: string;
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
			resolve: makeLuauResolver(cwd),
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
		const candidate = join(cwd, LUAU_CONFIG_BASENAME);
		return existsSync(candidate) ? candidate : undefined;
	}

	return undefined;
}

function makeLuauResolver(
	defaultCwd: string,
): (
	source: string,
	c12Options: { readonly configFile?: string; readonly cwd?: string },
) => Promise<LuauResolveResult | undefined> {
	return async (source, c12Options) => {
		// For auto-discovery (source === "."), defer when the caller named a
		// specific configFile - their intent is to load that exact file, not
		// whatever bedrock.config.luau happens to be sitting next to it.
		// Explicit `.luau` paths (e.g. an extends clause) always go through us.
		if (source === "." && c12Options.configFile !== undefined) {
			return;
		}

		const cwd = c12Options.cwd ?? defaultCwd;
		const luauPath = locateLuauConfig(source, cwd);
		if (luauPath === undefined) {
			return;
		}

		const config = await evaluateLuauConfig(luauPath);
		return {
			_configFile: luauPath,
			config,
			configFile: luauPath,
			cwd,
		};
	};
}

const LUAU_CONFIG_BASENAME = "bedrock.config.luau";

const LUTE_BOOTSTRAP_LUAU = `--!strict
local json = require("@std/json")
local process = require("@std/process")
local io = require("@std/io")

local function emit(kind, payload)
    io.write("__BEDROCK_LUAU_" .. kind .. "__")
    io.write(json.serialize(payload))
end

local userBasename = process.args[2]
-- The user file lives in a different directory from this bootstrap, so we
-- require it via the @user alias defined in the .luaurc written alongside.
local req = "@user/" .. string.gsub(userBasename, "%.luau$", "")

local loadOk, modOrErr = pcall(require, req)
if not loadOk then
    emit("ERR", { kind = "loadFailed", message = tostring(modOrErr) })
    return
end

local value = if type(modOrErr) == "function" then modOrErr() else modOrErr

local encOk, encoded = pcall(json.serialize, value)
if not encOk then
    emit("ERR", { kind = "serializeFailed", message = tostring(encoded) })
    return
end

io.write("__BEDROCK_LUAU_OK__")
io.write(encoded)
`;

class LuauRuntimeMissingError extends Error {
	public readonly hint: string;
	public override readonly name = "LuauRuntimeMissingError";
	public readonly sourceFile: string;

	constructor(sourceFile: string, hint: string) {
		super(`Luau runtime missing: ${hint}`);
		this.hint = hint;
		this.sourceFile = sourceFile;
	}
}

const LUAU_RUNTIME_HINT =
	"install lute (e.g. `mise install` with `github:luau-lang/lute`) or set BEDROCK_LUTE_PATH to the binary.";

interface LuteRunOptions {
	readonly bin: string;
	readonly bootstrapPath: string;
	readonly cwd: string;
	readonly userBasename: string;
}

function isEnoentError(error: unknown): boolean {
	if (!(error instanceof Error) || !("code" in error)) {
		return false;
	}

	return error.code === "ENOENT";
}

async function runLuteBootstrap(runOptions: LuteRunOptions): Promise<string> {
	const { bin, bootstrapPath, cwd, userBasename } = runOptions;
	return new Promise((resolve, reject) => {
		execFile(
			bin,
			["run", bootstrapPath, userBasename],
			{ cwd, encoding: "utf8" },
			(error, stdout) => {
				if (error instanceof Error) {
					reject(error);
					return;
				}

				resolve(stdout);
			},
		);
	});
}

async function evaluateLuauConfig(absPath: string): Promise<Record<string, unknown>> {
	const overridePath = process.env["BEDROCK_LUTE_PATH"];
	const lute = overridePath !== undefined && overridePath.length > 0 ? overridePath : "lute";
	const cwd = dirname(absPath);
	const base = basename(absPath);

	const bootstrapDirectory = mkdtempSync(join(tmpdir(), "bedrock-lute-"));
	const bootstrapPath = join(bootstrapDirectory, "bootstrap.luau");
	writeFileSync(bootstrapPath, LUTE_BOOTSTRAP_LUAU);
	// Lute resolves `require` relative to the calling script's directory, not
	// the process cwd. The bootstrap lives in a temp dir, so we expose the
	// user's directory via a `.luaurc` alias that the bootstrap requires by name.
	writeFileSync(join(bootstrapDirectory, ".luaurc"), JSON.stringify({ aliases: { user: cwd } }));

	let stdout: string;
	try {
		stdout = await runLuteBootstrap({
			bin: lute,
			bootstrapPath,
			cwd,
			userBasename: base,
		});
	} catch (err) {
		if (isEnoentError(err)) {
			throw new LuauRuntimeMissingError(absPath, LUAU_RUNTIME_HINT);
		}

		throw err;
	}

	return parseBootstrapOutput(stdout);
}

const OK_PREFIX = "__BEDROCK_LUAU_OK__";
const ERR_PREFIX = "__BEDROCK_LUAU_ERR__";

function isLuauErrorEnvelope(value: unknown): value is { readonly message: string } {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	return "message" in value && typeof value.message === "string";
}

function parseBootstrapOutput(stdout: string): Record<string, unknown> {
	if (stdout.startsWith(ERR_PREFIX)) {
		const envelope = JSON.parse(stdout.slice(ERR_PREFIX.length));
		const message = isLuauErrorEnvelope(envelope)
			? envelope.message
			: stdout.slice(ERR_PREFIX.length);
		throw new Error(message);
	}

	if (!stdout.startsWith(OK_PREFIX)) {
		throw new Error(
			`Luau config evaluation produced unexpected output: ${stdout.slice(0, 200)}`,
		);
	}

	const parsed = JSON.parse(stdout.slice(OK_PREFIX.length));

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new TypeError("Luau config must return a table at the root");
	}

	return parsed as Record<string, unknown>;
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
