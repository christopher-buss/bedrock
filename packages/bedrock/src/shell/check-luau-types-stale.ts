import type { Result } from "@bedrock-rbx/ocale";

import { join } from "node:path";

import {
	type InvalidTypesPathError,
	LUAU_SETUP_STATE_PATH,
	type MalformedSetupStateError,
	parseLuauSetupState,
	resolveLuauSetup,
} from "../core/luau-setup-state.ts";
import { type FileStepError, readOptionalFileStepAsync } from "./file-step.ts";

/** Read-only seams and inputs for {@link checkLuauTypesStaleAsync}. */
export interface CheckLuauTypesStaleDeps {
	/** The `@bedrock/config` Luau source this bedrock version ships. */
	readonly bundledSource: string;
	/** Directory `setup` wrote the Luau types under. */
	readonly projectRoot: string;
	/** Reads a UTF-8 text file, resolving `undefined` when it is absent. */
	readonly readOptionalTextFile: (path: string) => Promise<string | undefined>;
}

/** Why {@link checkLuauTypesStaleAsync} could not compare the types. */
export type CheckLuauTypesStaleError =
	| FileStepError<"fileReadFailed">
	| InvalidTypesPathError
	| MalformedSetupStateError;

/** What {@link checkLuauTypesStaleAsync} found. */
export interface LuauTypesStaleness {
	/** How the on-disk types compare with the shipped source. */
	readonly status: LuauTypesStatus;
	/** Path of the Luau types file. */
	readonly typesPath: string;
}

/**
 * How the on-disk Luau types compare with the shipped source: `fresh` when
 * identical, `stale` when any byte differs, `missing` when `setup` has not
 * written them.
 */
type LuauTypesStatus = "fresh" | "missing" | "stale";

/**
 * Compare the Luau types `setup` wrote with the source this bedrock version
 * ships. The types file is the one a prior `setup` run recorded, or
 * `.bedrock/config.luau` when none did. Reads only; never writes.
 *
 * @param deps - The read seam, the project root, and the bundled source.
 * @returns Whether the on-disk types are fresh, stale, or missing, or why
 *   they cannot be compared: a file exists but cannot be read, or the
 *   recorded setup state is malformed or names an unusable types path.
 */
export async function checkLuauTypesStaleAsync(
	deps: CheckLuauTypesStaleDeps,
): Promise<Result<LuauTypesStaleness, CheckLuauTypesStaleError>> {
	const located = await locateTypesAsync(deps);
	if (!located.success) {
		return located;
	}

	const typesPath = located.data;
	const read = await readOptionalFileStepAsync(deps.readOptionalTextFile, typesPath);
	if (!read.success) {
		return read;
	}

	const onDisk = read.data;
	if (onDisk === undefined) {
		return { data: { status: "missing", typesPath }, success: true };
	}

	return {
		data: { status: onDisk === deps.bundledSource ? "fresh" : "stale", typesPath },
		success: true,
	};
}

async function locateTypesAsync(
	deps: CheckLuauTypesStaleDeps,
): Promise<Result<string, CheckLuauTypesStaleError>> {
	const state = await readOptionalFileStepAsync(
		deps.readOptionalTextFile,
		join(deps.projectRoot, LUAU_SETUP_STATE_PATH),
	);
	if (!state.success) {
		return state;
	}

	const recorded = parseLuauSetupState(state.data);
	if (!recorded.success) {
		return recorded;
	}

	const resolved = resolveLuauSetup(recorded.data, {});
	if (!resolved.success) {
		return resolved;
	}

	return { data: join(deps.projectRoot, resolved.data.typesPath), success: true };
}
