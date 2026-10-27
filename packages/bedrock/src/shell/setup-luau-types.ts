import type { Result } from "@bedrock-rbx/ocale";

import { dirname, join } from "node:path";

import type { LuauAlias } from "../core/luau-config-alias.ts";
import {
	type InvalidTypesPathError,
	LUAU_SETUP_STATE_PATH,
	luauAliasTarget,
	type LuauSetupOverrides,
	type LuauSetupState,
	type MalformedSetupStateError,
	parseLuauSetupState,
	resolveLuauSetup,
	serializeLuauSetupState,
} from "../core/luau-setup-state.ts";
import type { ConfigLuauEditor } from "../ports/config-luau-editor.ts";
import {
	attemptFileStepAsync,
	type FileStepError,
	readOptionalFileStepAsync,
} from "./file-step.ts";
import {
	configLuauPath,
	type LuauConfigAliasError,
	planLuauConfigAliasAsync,
} from "./plan-luau-config-alias.ts";

/** Filesystem seams and inputs for {@link setupLuauTypesAsync}. */
export interface SetupLuauTypesDeps {
	/** The `@bedrock/config` Luau source this bedrock version ships. */
	readonly bundledSource: string;
	/** Reads and edits the aliases of a `.config.luau` source. */
	readonly configLuauEditor: ConfigLuauEditor;
	/** Creates a directory, parents included. */
	readonly mkdir: (path: string) => Promise<void>;
	/** Alias and types path passed on the command line. */
	readonly overrides?: LuauSetupOverrides;
	/** Directory holding the project's `.luaurc` or `.config.luau`. */
	readonly projectRoot: string;
	/** Reads a UTF-8 text file, resolving `undefined` when it is absent. */
	readonly readOptionalTextFile: (path: string) => Promise<string | undefined>;
	/** Moves a file onto another path, replacing what is there. */
	readonly rename: (from: string, to: string) => Promise<void>;
	/** Writes a UTF-8 text file. */
	readonly writeFile: (path: string, contents: string) => Promise<void>;
}

/** Why {@link setupLuauTypesAsync} stopped. */
export type SetupLuauTypesError =
	| FileStepError
	| InvalidTypesPathError
	| LuauConfigAliasError
	| MalformedSetupStateError;

/** What {@link setupLuauTypesAsync} found and wrote. */
export interface SetupLuauTypesReport {
	/** Alias name declared in the Luau config file, without the leading `@`. */
	readonly alias: string;
	/** Path of the project's `.luaurc` or `.config.luau`. */
	readonly configPath: string;
	/** Whether the Luau config file was written. */
	readonly configWritten: boolean;
	/** Path of the Luau types file. */
	readonly typesPath: string;
	/** Whether the Luau types file was written. */
	readonly typesWritten: boolean;
}

interface FileUpdate {
	readonly changed: boolean;
	readonly content: string;
	readonly path: string;
}

interface SetupPlan {
	readonly config: FileUpdate;
	readonly setup: LuauSetupState;
	readonly state: FileUpdate;
	readonly types: FileUpdate;
}

interface StatePlan {
	readonly setup: LuauSetupState;
	readonly update: FileUpdate;
	/** The alias to declare, replacing the target a prior run declared. */
	readonly wanted: LuauAlias;
}

interface WriteStep {
	readonly path: string;
	readonly run: () => Promise<void>;
}

/**
 * Write the bundled `@bedrock/config` Luau source to the types path and
 * declare the alias pointing at its directory in the project's Luau config
 * file: `.config.luau` when the project has one, edited in place, else
 * `.luaurc`, created when absent. The alias and types path come from the
 * overrides, then from what a prior run recorded, then from the defaults; the
 * choice is recorded for the next run, and an alias a prior run declared
 * follows the types path. A file that already holds the wanted content is not
 * written. When the project holds both config files, the config file cannot
 * take the alias, the types path is absolute, outside the project, or not a
 * `config.luau` file, the recorded state cannot be read, or a file cannot be
 * read, nothing is written. `.config.luau` is written to a temp file beside it
 * and moved into place. A failed write stops at that file, and the choice
 * is recorded only after the config file is written, so a rerun can finish a
 * move.
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
		const written = await attemptFileStepAsync("fileWriteFailed", write);
		if (!written.success) {
			return written;
		}
	}

	const { config, setup, types } = plan.data;
	return {
		data: {
			alias: setup.alias,
			configPath: config.path,
			configWritten: config.changed,
			typesPath: types.path,
			typesWritten: types.changed,
		},
		success: true,
	};
}

function writeStep(deps: SetupLuauTypesDeps, { content, path }: FileUpdate): WriteStep {
	return { path, run: async () => deps.writeFile(path, content) };
}

function replaceStep(deps: SetupLuauTypesDeps, { content, path }: FileUpdate): WriteStep {
	const temporary = `${path}.tmp`;
	return {
		path,
		run: async () => {
			await deps.writeFile(temporary, content);
			await deps.rename(temporary, path);
		},
	};
}

function configWrite(deps: SetupLuauTypesDeps, config: FileUpdate): Array<WriteStep> {
	if (!config.changed) {
		return [];
	}

	return [
		config.path === configLuauPath(deps.projectRoot)
			? replaceStep(deps, config)
			: writeStep(deps, config),
	];
}

function inDirectoryWrite(deps: SetupLuauTypesDeps, update: FileUpdate): Array<WriteStep> {
	return update.changed
		? [
				{ path: dirname(update.path), run: async () => deps.mkdir(dirname(update.path)) },
				writeStep(deps, update),
			]
		: [];
}

function planWrites(
	deps: SetupLuauTypesDeps,
	{ config, state, types }: SetupPlan,
): Array<WriteStep> {
	return [
		...inDirectoryWrite(deps, types),
		...configWrite(deps, config),
		...inDirectoryWrite(deps, state),
	];
}

function fileUpdate(
	path: string,
	{ content, existing }: { readonly content: string; readonly existing: string | undefined },
): FileUpdate {
	return { changed: existing !== content, content, path };
}

function wantedAlias(recorded: LuauSetupState | undefined, setup: LuauSetupState): LuauAlias {
	return {
		alias: setup.alias,
		replaces: recorded?.alias === setup.alias ? luauAliasTarget(recorded.typesPath) : undefined,
		target: luauAliasTarget(setup.typesPath),
	};
}

async function readStateAsync(
	deps: SetupLuauTypesDeps,
	statePath: string,
): Promise<Result<StatePlan, SetupLuauTypesError>> {
	const existing = await readOptionalFileStepAsync(deps.readOptionalTextFile, statePath);
	if (!existing.success) {
		return existing;
	}

	const recorded = parseLuauSetupState(existing.data);
	if (!recorded.success) {
		return recorded;
	}

	const resolved = resolveLuauSetup(recorded.data, deps.overrides ?? {});
	if (!resolved.success) {
		return resolved;
	}

	const setup = resolved.data;
	return {
		data: {
			setup,
			update: fileUpdate(statePath, {
				content: serializeLuauSetupState(setup),
				existing: existing.data,
			}),
			wanted: wantedAlias(recorded.data, setup),
		},
		success: true,
	};
}

async function planAsync(
	deps: SetupLuauTypesDeps,
): Promise<Result<SetupPlan, SetupLuauTypesError>> {
	const state = await readStateAsync(deps, join(deps.projectRoot, LUAU_SETUP_STATE_PATH));
	if (!state.success) {
		return state;
	}

	const { setup, update, wanted } = state.data;
	const config = await planLuauConfigAliasAsync(deps, wanted);
	if (!config.success) {
		return config;
	}

	const typesFile = join(deps.projectRoot, setup.typesPath);
	const existingTypes = await readOptionalFileStepAsync(deps.readOptionalTextFile, typesFile);
	if (!existingTypes.success) {
		return existingTypes;
	}

	return {
		data: {
			config: config.data,
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
