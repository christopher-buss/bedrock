import type { Result } from "@bedrock-rbx/ocale";

import type { LuauSetupOverrides } from "../core/luau-setup-state.ts";
import { type ParseOptionsError, readOptionalString } from "./parse-options.ts";

const RECOGNIZED_FLAGS: ReadonlySet<string> = new Set(["alias", "check", "types-path"]);

const SADE_RESERVED: ReadonlySet<string> = new Set(["--", "_", "h", "help", "v", "version"]);

/**
 * Translate the raw sade options POJO into the overrides `bedrock setup`
 * takes from `--alias` and `--types-path`. One leading `@` is dropped from
 * the alias.
 *
 * @param rawOptions - The options object sade hands the action callback.
 * @returns `Ok(LuauSetupOverrides)` on success, or `Err(ParseOptionsError)`
 *   naming the offending flag.
 */
export function parseSetupOptions(
	rawOptions: Readonly<Record<string, unknown>>,
): Result<LuauSetupOverrides, ParseOptionsError> {
	for (const key of Object.keys(rawOptions)) {
		if (!RECOGNIZED_FLAGS.has(key) && !SADE_RESERVED.has(key)) {
			return { err: { flag: key, kind: "unknownFlag" }, success: false };
		}
	}

	const alias = readAlias(rawOptions);
	if (!alias.success) {
		return alias;
	}

	const typesPath = readOptionalString(rawOptions, "types-path");
	if (!typesPath.success) {
		return typesPath;
	}

	return { data: { alias: alias.data, typesPath: typesPath.data }, success: true };
}

function readAlias(
	rawOptions: Readonly<Record<string, unknown>>,
): Result<string | undefined, ParseOptionsError> {
	const raw = readOptionalString(rawOptions, "alias");
	if (!raw.success) {
		return raw;
	}

	const alias = raw.data?.startsWith("@") === true ? raw.data.slice(1) : raw.data;
	if (alias === "") {
		return { err: { flag: "alias", kind: "invalidValue" }, success: false };
	}

	return { data: alias, success: true };
}
