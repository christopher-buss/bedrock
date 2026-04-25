import type { Result } from "@bedrock/ocale";

/**
 * Typed shape command actions consume after the raw sade options object has
 * been validated and normalized.
 */
export interface CommonOptions {
	/** Roblox Open Cloud API key override; falls back to ROBLOX_API_KEY when undefined. */
	readonly apiKey?: string;
	/** Explicit config file path; when undefined the loader's discovery rules apply. */
	readonly configFile?: string;
	/** Target environment names. Sade collects `--env` repeatedly into this list. */
	readonly environments: ReadonlyArray<string>;
	/** GitHub token override; falls back to GITHUB_TOKEN when undefined. */
	readonly githubToken?: string;
}

/**
 * Failure modes surfaced by `parseCommonOptions`. Every variant names the
 * offending flag so callers can render a precise diagnostic.
 */
export type ParseOptionsError =
	| { readonly flag: string; readonly kind: "invalidValue" }
	| { readonly flag: string; readonly kind: "missingRequired" }
	| { readonly flag: string; readonly kind: "unknownFlag" };

const RECOGNIZED_FLAGS: ReadonlySet<string> = new Set([
	"api-key",
	"apiKey",
	"config",
	"env",
	"github-token",
	"githubToken",
]);

const SADE_RESERVED: ReadonlySet<string> = new Set(["--", "_", "h", "help", "v", "version"]);

/**
 * Translate the raw sade options POJO into a typed `CommonOptions`. Pure: no
 * I/O, no clack, no sade types. Reused by `bedrock deploy` and `bedrock diff`.
 * @param rawOptions - The options object sade hands the action callback.
 * @returns `Ok(CommonOptions)` on success, or `Err(ParseOptionsError)` when a
 *   required flag is missing or an unrecognized flag was supplied.
 */
export function parseCommonOptions(
	rawOptions: Readonly<Record<string, unknown>>,
): Result<CommonOptions, ParseOptionsError> {
	for (const key of Object.keys(rawOptions)) {
		if (!RECOGNIZED_FLAGS.has(key) && !SADE_RESERVED.has(key)) {
			return { err: { flag: key, kind: "unknownFlag" }, success: false };
		}
	}

	const environments = resolveEnvironments(rawOptions["env"]);
	if (!environments.success) {
		return environments;
	}

	const apiKey = pickString(rawOptions, "apiKey", "api-key");
	const configFile = pickString(rawOptions, "config");
	const githubToken = pickString(rawOptions, "githubToken", "github-token");

	return {
		data: {
			environments: environments.data,
			...(apiKey === undefined ? {} : { apiKey }),
			...(configFile === undefined ? {} : { configFile }),
			...(githubToken === undefined ? {} : { githubToken }),
		},
		success: true,
	};
}

function resolveEnvironments(raw: unknown): Result<ReadonlyArray<string>, ParseOptionsError> {
	if (raw === undefined) {
		return { err: { flag: "env", kind: "missingRequired" }, success: false };
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
