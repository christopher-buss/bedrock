import type { Result } from "@bedrock-rbx/ocale";

import process from "node:process";

import type { LoadConfigOptions } from "../shell/load-config.ts";
import type { LiveCheckOptions } from "../shell/read-live-state.ts";
import { parseLiveOptions } from "./live-options.ts";

/**
 * Typed shape command actions consume after the raw sade options object has
 * been validated and normalized.
 */
export interface CommonOptions extends LiveCheckOptions {
	/** `true` when `--allow-spend` gives the run spend approval. */
	readonly allowSpend?: boolean;
	/**
	 * Roblox Open Cloud API key override; falls back to BEDROCK_API_KEY when
	 * undefined.
	 */
	readonly apiKey?: string;
	/**
	 * Explicit config file path; when undefined the loader's discovery rules
	 * apply.
	 */
	readonly configFile?: string;
	/**
	 * Target environment names. Sade collects `--env` repeatedly into this
	 * list.
	 */
	readonly environments: ReadonlyArray<string>;
	/**
	 * GitHub token override; falls back to BEDROCK_GITHUB_TOKEN when
	 * undefined.
	 */
	readonly githubToken?: string;
	/**
	 * Whether failures print their retry attempts, stacks, and cause chain;
	 * falls back to a `1` or `true` BEDROCK_VERBOSE when `--verbose` is absent.
	 */
	readonly verbose: boolean;
}

/**
 * Failure modes surfaced by `parseCommonOptions`. Every variant names the
 * offending flag so callers can render a precise diagnostic.
 */
export type ParseOptionsError =
	| { readonly flag: string; readonly kind: "invalidValue" }
	| { readonly flag: string; readonly kind: "missingRequired" }
	| { readonly flag: string; readonly kind: "switchGivenValue" }
	| { readonly flag: string; readonly kind: "unknownFlag" };

const RECOGNIZED_FLAGS: ReadonlySet<string> = new Set([
	"allow-spend",
	"allowSpend",
	"api-key",
	"apiKey",
	"config",
	"env",
	"fail-on-out-of-band-edit",
	"failOnOutOfBandEdit",
	"github-token",
	"githubToken",
	"live",
	"no-live",
	"verbose",
]);

const SADE_RESERVED: ReadonlySet<string> = new Set(["--", "_", "h", "help", "v", "version"]);

/**
 * Read the credential and config-path flags, in either spelling.
 *
 * @param raw - The options object sade hands the action callback.
 * @returns The flags that were given as strings.
 */
export function credentialOptions(
	raw: Readonly<Record<string, unknown>>,
): Pick<CommonOptions, "apiKey" | "configFile" | "githubToken"> {
	const apiKey = pickString(raw, "apiKey", "api-key");
	const configFile = pickString(raw, "config");
	const githubToken = pickString(raw, "githubToken", "github-token");
	return {
		...(apiKey === undefined ? {} : { apiKey }),
		...(configFile === undefined ? {} : { configFile }),
		...(githubToken === undefined ? {} : { githubToken }),
	};
}

/**
 * Translate the raw sade options POJO into a typed `CommonOptions`. Reads
 * `BEDROCK_ENVIRONMENT` and `BEDROCK_VERBOSE` from `process.env` as
 * fallbacks when `--env` or `--verbose` is absent; inject `getEnvironment`
 * to redirect or isolate the lookup. No clack, no sade types. Reused by
 * `bedrock deploy` and `bedrock diff`.
 * @param rawOptions - The options object sade hands the action callback.
 * @param getEnvironment - Reads an environment variable; consulted as a
 *   fallback for `--env` and `--verbose` when no flag was supplied. Defaults
 *   to a `process.env` reader.
 * @returns `Ok(CommonOptions)` on success, or `Err(ParseOptionsError)` when a
 *   required flag is missing or an unrecognized flag was supplied.
 */
export function parseCommonOptions(
	rawOptions: Readonly<Record<string, unknown>>,
	getEnvironment: (name: string) => string | undefined = readProcessEnvironment,
): Result<CommonOptions, ParseOptionsError> {
	for (const key of Object.keys(rawOptions)) {
		if (!RECOGNIZED_FLAGS.has(key) && !SADE_RESERVED.has(key)) {
			return { err: { flag: key, kind: "unknownFlag" }, success: false };
		}
	}

	const environments = resolveEnvironments(rawOptions["env"], getEnvironment);
	if (!environments.success) {
		return environments;
	}

	const verbose = resolveVerbose(rawOptions["verbose"], getEnvironment);
	if (!verbose.success) {
		return verbose;
	}

	const switches = parseSwitches(rawOptions);
	if (!switches.success) {
		return switches;
	}

	return {
		data: {
			...credentialOptions(rawOptions),
			...switches.data,
			environments: environments.data,
			verbose: verbose.data,
		},
		success: true,
	};
}

/**
 * Map the parsed common options to a `loadConfig` options object. Returns
 * `undefined` when no `--config` path was supplied so the loader applies its
 * own discovery rules; otherwise forwards the explicit path. Shared by the
 * `deploy` and `build` commands' no-override paths.
 * @param parsed - The validated common options.
 * @returns `{ configFile }` when a path was supplied, otherwise `undefined`.
 */
export function loadOptionsFor(parsed: CommonOptions): LoadConfigOptions | undefined {
	return parsed.configFile === undefined ? undefined : { configFile: parsed.configFile };
}

/**
 * Read a flag that is optional but must hold a non-empty string when given.
 *
 * @param rawOptions - The options object sade hands the action callback.
 * @param flag - The flag to read, as it is documented.
 * @returns The value, `undefined` when the flag is absent, or the offending
 *   flag.
 */
export function readOptionalString(
	rawOptions: Readonly<Record<string, unknown>>,
	flag: string,
): Result<string | undefined, ParseOptionsError> {
	const value = rawOptions[flag];
	if (value !== undefined && (typeof value !== "string" || value === "")) {
		return { err: { flag, kind: "invalidValue" }, success: false };
	}

	return { data: value, success: true };
}

function parseSwitches(
	rawOptions: Readonly<Record<string, unknown>>,
): Result<Pick<CommonOptions, "allowSpend" | keyof LiveCheckOptions>, ParseOptionsError> {
	const live = parseLiveOptions(rawOptions);
	if (!live.success) {
		return live;
	}

	const allowSpend = rawOptions["allowSpend"] ?? rawOptions["allow-spend"];
	if (allowSpend !== undefined && typeof allowSpend !== "boolean") {
		return { err: { flag: "allow-spend", kind: "switchGivenValue" }, success: false };
	}

	return {
		data: { ...live.data, ...(allowSpend === true ? { allowSpend } : {}) },
		success: true,
	};
}

function resolveEnvironments(
	raw: unknown,
	getEnvironment: (name: string) => string | undefined,
): Result<ReadonlyArray<string>, ParseOptionsError> {
	if (raw === undefined) {
		const fallback = getEnvironment("BEDROCK_ENVIRONMENT");
		if (fallback === undefined) {
			return { err: { flag: "env", kind: "missingRequired" }, success: false };
		}

		return { data: [fallback], success: true };
	}

	const candidates = Array.isArray(raw) ? raw : [raw];
	const environments: Array<string> = [];
	for (const candidate of candidates) {
		if (typeof candidate !== "string") {
			return { err: { flag: "env", kind: "invalidValue" }, success: false };
		}

		environments.push(candidate);
	}

	return { data: environments, success: true };
}

const TRUTHY_VERBOSE: ReadonlySet<string> = new Set(["1", "true"]);

/**
 * Whether a `BEDROCK_VERBOSE` value asks for verbose diagnostics.
 *
 * @param value - The raw environment value, or `undefined` when unset.
 * @returns `true` for `1` or `true`.
 */
export function isVerboseEnvironmentValue(value: string | undefined): boolean {
	return TRUTHY_VERBOSE.has(String(value));
}

/**
 * Read `--verbose`, falling back to `BEDROCK_VERBOSE` when it is absent.
 *
 * @param raw - The raw `--verbose` value.
 * @param getEnvironment - Reads an environment variable.
 * @returns Whether verbose diagnostics are on, or the misused flag.
 */
export function resolveVerbose(
	raw: unknown,
	getEnvironment: (name: string) => string | undefined,
): Result<boolean, ParseOptionsError> {
	if (raw === undefined) {
		return {
			data: isVerboseEnvironmentValue(getEnvironment("BEDROCK_VERBOSE")),
			success: true,
		};
	}

	if (typeof raw !== "boolean") {
		return { err: { flag: "verbose", kind: "switchGivenValue" }, success: false };
	}

	return { data: raw, success: true };
}

function readProcessEnvironment(name: string): string | undefined {
	return process.env[name];
}

function pickString(
	rawOptions: Readonly<Record<string, unknown>>,
	...keys: ReadonlyArray<string>
): string | undefined {
	for (const key of keys) {
		const value = rawOptions[key];
		if (typeof value === "string") {
			return value;
		}
	}

	return undefined;
}
