import type { Result } from "@bedrock-rbx/ocale";

import { dirname, join } from "node:path";

import {
	LUAU_SETUP_STATE_PATH,
	luauAliasTarget,
	type LuauSetupOverrides,
	type LuauSetupState,
	type MalformedSetupStateError,
	parseLuauSetupState,
	resolveLuauSetup,
	serializeLuauSetupState,
} from "../core/luau-setup-state.ts";
import { addLuaurcAlias, type LuaurcAliasError } from "../core/luaurc.ts";

const LUAURC_FILE = ".luaurc";

/** Filesystem seams and inputs for {@link setupLuauTypesAsync}. */
export interface SetupLuauTypesDeps {
	/** The `@bedrock/config` Luau source this bedrock version ships. */
	readonly bundledSource: string;
	/** Creates a directory, parents included. */
	readonly mkdir: (path: string) => Promise<void>;
	/** Alias and types path passed on the command line. */
	readonly overrides?: LuauSetupOverrides;
	/** Directory holding the project's `.luaurc`. */
	readonly projectRoot: string;
	/** Reads a UTF-8 text file, resolving `undefined` when it is absent. */
	readonly readOptionalTextFile: (path: string) => Promise<string | undefined>;
	/** Writes a UTF-8 text file. */
	readonly writeFile: (path: string, contents: string) => Promise<void>;
}

/** Why {@link setupLuauTypesAsync} stopped. */
export type SetupLuauTypesError = LuaurcAliasError | MalformedSetupStateError | SetupFileError;

/** What {@link setupLuauTypesAsync} found and wrote. */
export interface SetupLuauTypesReport {
	/** Alias name declared in the `.luaurc`, without the leading `@`. */
	readonly alias: string;
	/** Path of the project's `.luaurc`. */
	readonly luaurcPath: string;
	/** Whether the `.luaurc` was written. */
	readonly luaurcWritten: boolean;
	/** Path of the Luau types file. */
	readonly typesPath: string;
	/** Whether the Luau types file was written. */
	readonly typesWritten: boolean;
}

/**
 * A file `bedrock setup` could not read, or could not write (directory
 * creation included). A read fails before anything is written; a write may
 * follow earlier writes.
 */
interface SetupFileError {
	/** The value the filesystem seam rejected with. */
	readonly cause: unknown;
	/** Whether the read or the write failed. */
	readonly kind: "fileReadFailed" | "fileWriteFailed";
	/** Path of the file or directory that failed. */
	readonly path: string;
}

interface FileUpdate {
	readonly changed: boolean;
	readonly content: string;
	readonly path: string;
}

interface SetupPlan {
	readonly luaurc: FileUpdate;
	readonly setup: LuauSetupState;
	readonly state: FileUpdate;
	readonly types: FileUpdate;
}

interface StatePlan {
	/** The alias target a prior run declared for the chosen alias. */
	readonly replaces: string | undefined;
	readonly setup: LuauSetupState;
	readonly update: FileUpdate;
}

interface WriteStep {
	readonly path: string;
	readonly run: () => Promise<void>;
}

/**
 * Write the bundled `@bedrock/config` Luau source to the types path and
 * declare the alias pointing at its directory in the project's `.luaurc`,
 * creating it when absent. The alias and types path come from the
 * overrides, then from what a prior run recorded, then from the defaults;
 * the choice is recorded for the next run, and an alias a prior run
 * declared follows the types path. A file that already holds the
 * wanted content is not written. When the `.luaurc` cannot take the alias,
 * the recorded state cannot be read, or a file cannot be read, nothing is
 * written. A failed write stops at that file.
 *
 * @param deps - Filesystem seams, the project root, overrides, and the
 *   bundled source.
 * @returns What was written, or why setup stopped.
 */
export async function setupLuauTypesAsync(
	deps: SetupLuauTypesDeps,
): Promise<Result<SetupLuauTypesReport, SetupLuauTypesError>> {
	const plan = await planAsync(deps);
	if (!plan.success) {
		return plan;
	}

	for (const write of planWrites(deps, plan.data)) {
		const written = await attemptAsync("fileWriteFailed", write);
		if (!written.success) {
			return written;
		}
	}

	const { luaurc, setup, types } = plan.data;
	return {
		data: {
			alias: setup.alias,
			luaurcPath: luaurc.path,
			luaurcWritten: luaurc.changed,
			typesPath: types.path,
			typesWritten: types.changed,
		},
		success: true,
	};
}

function writeStep(deps: SetupLuauTypesDeps, { content, path }: FileUpdate): WriteStep {
	return { path, run: async () => deps.writeFile(path, content) };
}

function planWrites(
	deps: SetupLuauTypesDeps,
	{ luaurc, state, types }: SetupPlan,
): Array<WriteStep> {
	const inDirectory = [types, state].flatMap((update) => {
		return update.changed
			? [
					{
						path: dirname(update.path),
						run: async () => deps.mkdir(dirname(update.path)),
					},
					writeStep(deps, update),
				]
			: [];
	});
	return luaurc.changed ? [...inDirectory, writeStep(deps, luaurc)] : inDirectory;
}

async function attemptAsync<T>(
	kind: SetupFileError["kind"],
	step: { readonly path: string; readonly run: () => Promise<T> },
): Promise<Result<T, SetupFileError>> {
	try {
		return { data: await step.run(), success: true };
	} catch (err) {
		return { err: { cause: err, kind, path: step.path }, success: false };
	}
}

async function readAsync(
	deps: SetupLuauTypesDeps,
	path: string,
): Promise<Result<string | undefined, SetupFileError>> {
	return attemptAsync("fileReadFailed", {
		path,
		run: async () => deps.readOptionalTextFile(path),
	});
}

function fileUpdate(
	path: string,
	{ content, existing }: { readonly content: string; readonly existing: string | undefined },
): FileUpdate {
	return { changed: existing !== content, content, path };
}

async function readStateAsync(
	deps: SetupLuauTypesDeps,
	statePath: string,
): Promise<Result<StatePlan, SetupLuauTypesError>> {
	const existing = await readAsync(deps, statePath);
	if (!existing.success) {
		return existing;
	}

	const recorded = parseLuauSetupState(existing.data);
	if (!recorded.success) {
		return recorded;
	}

	const setup = resolveLuauSetup(recorded.data, deps.overrides ?? {});
	return {
		data: {
			replaces:
				recorded.data?.alias === setup.alias
					? luauAliasTarget(recorded.data.typesPath)
					: undefined,
			setup,
			update: fileUpdate(statePath, {
				content: serializeLuauSetupState(setup),
				existing: existing.data,
			}),
		},
		success: true,
	};
}

async function planLuaurcAsync(
	deps: SetupLuauTypesDeps,
	{ replaces, setup: { alias, typesPath } }: StatePlan,
): Promise<Result<FileUpdate, SetupLuauTypesError>> {
	const path = join(deps.projectRoot, LUAURC_FILE);
	const existing = await readAsync(deps, path);
	if (!existing.success) {
		return existing;
	}

	const luaurc = addLuaurcAlias(existing.data, {
		alias,
		replaces,
		target: luauAliasTarget(typesPath),
	});
	if (!luaurc.success) {
		return luaurc;
	}

	return { data: { ...luaurc.data, path }, success: true };
}

async function planAsync(
	deps: SetupLuauTypesDeps,
): Promise<Result<SetupPlan, SetupLuauTypesError>> {
	const state = await readStateAsync(deps, join(deps.projectRoot, LUAU_SETUP_STATE_PATH));
	if (!state.success) {
		return state;
	}

	const { setup, update } = state.data;
	const luaurc = await planLuaurcAsync(deps, state.data);
	if (!luaurc.success) {
		return luaurc;
	}

	const typesFile = join(deps.projectRoot, setup.typesPath);
	const existingTypes = await readAsync(deps, typesFile);
	if (!existingTypes.success) {
		return existingTypes;
	}

	return {
		data: {
			luaurc: luaurc.data,
			setup,
			state: update,
			types: fileUpdate(typesFile, {
				content: deps.bundledSource,
				existing: existingTypes.data,
			}),
		},
		success: true,
	};
}
