import type { Result } from "@bedrock-rbx/ocale";

import { join } from "node:path";

import {
	type InvalidTypesPathError,
	LUAU_SETUP_STATE_PATH,
	luauAliasTarget,
	type LuauSetupState,
	type MalformedSetupStateError,
	parseLuauSetupState,
	resolveLuauSetup,
} from "../core/luau-setup-state.ts";
import type { ConfigLuauEditor } from "../ports/config-luau-editor.ts";
import { type FileStepError, readOptionalFileStepAsync } from "./file-step.ts";
import { configLuauPath, planLuauConfigAliasAsync } from "./plan-luau-config-alias.ts";

/** Read-only seams and inputs for {@link checkLuauTypesStaleAsync}. */
export interface CheckLuauTypesStaleDeps {
	/** The `@bedrock/config` Luau source this bedrock version ships. */
	readonly bundledSource: string;
	/** Reads the aliases of a `.config.luau` source. */
	readonly configLuauEditor: ConfigLuauEditor;
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

/**
 * A `.config.luau` that does not point the setup alias at the Luau types.
 */
export interface LuauAliasIssue {
	/** Alias name, without the leading `@`. */
	readonly alias: string;
	/** Path of the `.config.luau`. */
	readonly configPath: string;
	/** Whether the alias is absent or targets another path. */
	readonly kind: "aliasMissing" | "aliasPointsElsewhere";
}

/** What {@link checkLuauTypesStaleAsync} found. */
export interface LuauTypesStaleness {
	/**
	 * How the `.config.luau` alias is wrong, `undefined` when it is right,
	 * the project has no `.config.luau`, the types are missing, or the file
	 * cannot be read.
	 */
	readonly aliasIssue: LuauAliasIssue | undefined;
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
 * `.bedrock/config.luau` when none did. When the types exist and the
 * project uses `.config.luau`, also checks that it points the alias at
 * them. Reads only; never writes.
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

	const setup = located.data;
	const typesPath = join(deps.projectRoot, setup.typesPath);
	const read = await readOptionalFileStepAsync(deps.readOptionalTextFile, typesPath);
	if (!read.success) {
		return read;
	}

	const onDisk = read.data;
	if (onDisk === undefined) {
		return { data: { aliasIssue: undefined, status: "missing", typesPath }, success: true };
	}

	return {
		data: {
			aliasIssue: await checkAliasAsync(deps, setup),
			status: onDisk === deps.bundledSource ? "fresh" : "stale",
			typesPath,
		},
		success: true,
	};
}

async function checkAliasAsync(
	deps: CheckLuauTypesStaleDeps,
	{ alias, typesPath }: LuauSetupState,
): Promise<LuauAliasIssue | undefined> {
	const configPath = configLuauPath(deps.projectRoot);
	const planned = await planLuauConfigAliasAsync(deps, {
		alias,
		target: luauAliasTarget(typesPath),
	});
	if (planned.success) {
		return planned.data.path === configPath && planned.data.changed
			? { alias, configPath, kind: "aliasMissing" }
			: undefined;
	}

	return planned.err.kind === "aliasConflict" && planned.err.configPath === configPath
		? { alias, configPath, kind: "aliasPointsElsewhere" }
		: undefined;
}

async function locateTypesAsync(
	deps: CheckLuauTypesStaleDeps,
): Promise<Result<LuauSetupState, CheckLuauTypesStaleError>> {
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

	return resolved;
}
