import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import process from "node:process";

import type { LuauEvaluator } from "../ports/luau-evaluator.ts";
import { bootstrapDirectoryPrefix } from "../shell/load-config-internal.ts";

const SENTINEL_BASE = "__BEDROCK_LUAU_";
const OK_PREFIX = `${SENTINEL_BASE}OK__`;
const ERR_PREFIX = `${SENTINEL_BASE}ERR__`;

const LUTE_BOOTSTRAP_LUAU = `--!strict
local json = require("@std/json")
local process = require("@std/process")
local io = require("@std/io")

local function emit(kind, payload)
    io.write("${SENTINEL_BASE}" .. kind .. "__")
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

io.write("${OK_PREFIX}")
io.write(encoded)
`;

/**
 * Thrown by the lute adapter when no `lute` binary is reachable. Surfaces as a
 * `luauRuntimeMissing` `ConfigError` after `attributeLoadError` narrows on it.
 */
export class LuauRuntimeMissingError extends Error {
	public readonly hint: string;
	public readonly sourceFile: string;

	/**
	 * Construct an error attributed to a specific Luau source file.
	 * @param sourceFile - Absolute path of the `.luau` config the missing
	 * runtime would have evaluated.
	 * @param hint - Actionable install message surfaced to callers.
	 */
	constructor(sourceFile: string, hint: string) {
		// `super()` message would only ever surface as `.message`, but every
		// consumer narrows on `instanceof` and reads `.hint` / `.sourceFile`
		// instead, so a message string here would be dead.
		super();
		this.hint = hint;
		this.sourceFile = sourceFile;
	}
}

const LUAU_RUNTIME_HINT =
	"install lute (e.g. `mise install` with `github:luau-lang/lute`) or set BEDROCK_LUTE_PATH to the binary.";

interface LuteRunOptions {
	readonly bin: string;
	readonly bootstrapPath: string;
	readonly userBasename: string;
}

function isEnoentError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// 5s is generous for evaluating a config file: real configs run in
// milliseconds, and a value this high is meant to catch infinite loops in
// user code (or a hung lute) without surprising slow-startup environments.
const LUTE_BOOTSTRAP_TIMEOUT_MS = 5_000;

/**
 * Build the default `LuauEvaluator` adapter that shells out to the `lute`
 * runtime. Reads `BEDROCK_LUTE_PATH` from `process.env` once per call to pick
 * the binary, so tests can override it via env var without rebuilding the
 * adapter.
 * @returns A `LuauEvaluator` that spawns `lute run` per call.
 */
export function createLuteLuauEvaluator(): LuauEvaluator {
	return evaluateLuauWithLute;
}

function setupBootstrapDirectory(userCwd: string): string {
	const bootstrapDirectory = mkdtempSync(join(tmpdir(), bootstrapDirectoryPrefix(process.pid)));
	writeFileSync(join(bootstrapDirectory, "bootstrap.luau"), LUTE_BOOTSTRAP_LUAU);
	// Lute resolves `require` relative to the calling script's directory, not
	// the process cwd. The bootstrap lives in a temp dir, so we expose the
	// user's directory via a `.luaurc` alias that the bootstrap requires by
	// name.
	writeFileSync(
		join(bootstrapDirectory, ".luaurc"),
		JSON.stringify({ aliases: { user: userCwd } }),
	);
	return bootstrapDirectory;
}

async function runLuteBootstrap(runOptions: LuteRunOptions): Promise<string> {
	const { bin, bootstrapPath, userBasename } = runOptions;
	return new Promise((resolve, reject) => {
		execFile(
			bin,
			["run", bootstrapPath, userBasename],
			{ encoding: "utf8", timeout: LUTE_BOOTSTRAP_TIMEOUT_MS },
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

function parseBootstrapOutput(stdout: string): Record<string, unknown> {
	if (stdout.startsWith(ERR_PREFIX)) {
		// The bootstrap contract pairs ERR_PREFIX with `{ kind, message }`. Pass
		// the raw envelope through as the error text rather than reach into the
		// JSON: any unwrapping logic we add here is paranoid with no test
		// surface (the bootstrap is the only producer and always conforms).
		throw new Error(stdout.slice(ERR_PREFIX.length));
	}

	// Stdout that doesn't carry the OK prefix is unsupported; let JSON.parse
	// surface a SyntaxError rather than guard a defensive fallback that has
	// no observable behaviour.
	const parsed = JSON.parse(stdout.slice(OK_PREFIX.length));

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new TypeError("Luau config must return a table at the root");
	}

	return parsed;
}

async function evaluateLuauWithLute(absPath: string): Promise<Record<string, unknown>> {
	const overridePath = process.env["BEDROCK_LUTE_PATH"];
	const lute = overridePath !== undefined && overridePath.length > 0 ? overridePath : "lute";
	const bootstrapDirectory = setupBootstrapDirectory(dirname(absPath));
	try {
		const stdout = await runLuteBootstrap({
			bin: lute,
			bootstrapPath: join(bootstrapDirectory, "bootstrap.luau"),
			userBasename: basename(absPath),
		}).catch((err: unknown) => {
			if (isEnoentError(err)) {
				throw new LuauRuntimeMissingError(absPath, LUAU_RUNTIME_HINT);
			}

			throw err;
		});

		return parseBootstrapOutput(stdout);
	} finally {
		rmSync(bootstrapDirectory, { recursive: true });
	}
}
