import type { Result } from "@bedrock-rbx/ocale";

import { join } from "node:path";

import {
	configLuauAliasSnippet,
	decideLuauAlias,
	hasConflictingLuauConfigs,
	type LuauAlias,
} from "../core/luau-config-alias.ts";
import { addLuaurcAlias } from "../core/luaurc.ts";
import type { ConfigLuauEditor, ConfigLuauEditorError } from "../ports/config-luau-editor.ts";
import { type FileStepError, readOptionalFileStepAsync } from "./file-step.ts";

const LUAURC_FILE = ".luaurc";
const CONFIG_LUAU_FILE = ".config.luau";

/** Seams and inputs for {@link planLuauConfigAliasAsync}. */
export interface LuauConfigAliasDeps {
	/** Reads and edits the aliases of a `.config.luau` source. */
	readonly configLuauEditor: ConfigLuauEditor;
	/** Directory holding the project's `.luaurc` or `.config.luau`. */
	readonly projectRoot: string;
	/** Reads a UTF-8 text file, resolving `undefined` when it is absent. */
	readonly readOptionalTextFile: (path: string) => Promise<string | undefined>;
}

/** Why the Luau config file cannot declare the alias. */
export type LuauConfigAliasError =
	| {
			/** How to make the Luau runtime reachable. */
			readonly hint: string;
			readonly kind: "luauRuntimeMissing";
	  }
	| {
			/** Path of the `.config.luau`. */
			readonly configLuauPath: string;
			readonly kind: "conflictingLuauConfigs";
			/** Path of the `.luaurc`. */
			readonly luaurcPath: string;
	  }
	| {
			/** Path of the `.config.luau`. */
			readonly configPath: string;
			readonly kind: "uneditableConfigLuau";
			/** Why the file cannot be edited. */
			readonly reason: string;
			/** The entry to add to the returned table by hand. */
			readonly snippet: string;
	  }
	| {
			/** The alias that is already declared. */
			readonly alias: string;
			/** Path of the config file declaring it. */
			readonly configPath: string;
			/** The path the existing alias points at. */
			readonly existingTarget: string;
			readonly kind: "aliasConflict";
	  }
	| {
			readonly kind: "configLuauEditFailed";
			/** What the Luau runtime reported. */
			readonly message: string;
	  }
	| {
			readonly kind: "malformedLuaurc";
			/** What is wrong with the content. */
			readonly message: string;
	  };

/** Why {@link planLuauConfigAliasAsync} stopped. */
export type PlanLuauConfigAliasError = FileStepError<"fileReadFailed"> | LuauConfigAliasError;

/** The Luau config file with the alias declared. */
export interface LuauConfigUpdate {
	/** Whether `content` differs from what was read. */
	readonly changed: boolean;
	/** The config file text to write. */
	readonly content: string;
	/** Path of the config file. */
	readonly path: string;
}

interface ConfigTarget {
	readonly path: string;
	readonly wanted: LuauAlias;
}

/**
 * Where a project keeps its `.config.luau`.
 *
 * @param projectRoot - Directory the file sits in.
 * @returns The file's absolute path.
 */
export function configLuauPath(projectRoot: string): string {
	return join(projectRoot, CONFIG_LUAU_FILE);
}

/**
 * Plan declaring an alias in the project's Luau config file:
 * `.config.luau` when the project has one, edited in place through the
 * editor, else `.luaurc`, created when absent. Reads only.
 *
 * @param deps - The read seam, the editor, and the project root.
 * @param wanted - The alias, its target, and a previous target it may hold.
 * @returns The config file and its content with the alias declared, or why
 *   the alias cannot be declared.
 */
export async function planLuauConfigAliasAsync(
	deps: LuauConfigAliasDeps,
	wanted: LuauAlias,
): Promise<Result<LuauConfigUpdate, PlanLuauConfigAliasError>> {
	const luaurcPath = join(deps.projectRoot, LUAURC_FILE);
	const configPath = configLuauPath(deps.projectRoot);
	const luaurc = await readOptionalFileStepAsync(deps.readOptionalTextFile, luaurcPath);
	if (!luaurc.success) {
		return luaurc;
	}

	const configLuau = await readOptionalFileStepAsync(deps.readOptionalTextFile, configPath);
	if (!configLuau.success) {
		return configLuau;
	}

	if (
		hasConflictingLuauConfigs({
			configLuauExists: configLuau.data !== undefined,
			luaurcExists: luaurc.data !== undefined,
		})
	) {
		return {
			err: { configLuauPath: configPath, kind: "conflictingLuauConfigs", luaurcPath },
			success: false,
		};
	}

	return configLuau.data === undefined
		? planLuaurc(luaurc.data, { path: luaurcPath, wanted })
		: planConfigLuauAsync(deps, { path: configPath, source: configLuau.data, wanted });
}

function planLuaurc(
	existing: string | undefined,
	{ path, wanted }: { readonly path: string; readonly wanted: LuauAlias },
): Result<LuauConfigUpdate, PlanLuauConfigAliasError> {
	const luaurc = addLuaurcAlias(existing, wanted);
	if (!luaurc.success) {
		const { err } = luaurc;
		return {
			err: err.kind === "aliasConflict" ? { ...err, configPath: path } : err,
			success: false,
		};
	}

	return { data: { ...luaurc.data, path }, success: true };
}

function uneditable(reason: string, { path, wanted }: ConfigTarget): LuauConfigAliasError {
	return {
		configPath: path,
		kind: "uneditableConfigLuau",
		reason,
		snippet: configLuauAliasSnippet(wanted),
	};
}

function editorFailure(err: ConfigLuauEditorError, target: ConfigTarget): LuauConfigAliasError {
	switch (err.kind) {
		case "editorFailed": {
			return { kind: "configLuauEditFailed", message: err.message };
		}
		case "missingRuntime": {
			return { hint: err.hint, kind: "luauRuntimeMissing" };
		}
		case "uneditableConfigLuau": {
			return uneditable(err.reason, target);
		}
	}
}

async function planConfigLuauAsync(
	deps: LuauConfigAliasDeps,
	{ path, source, wanted }: ConfigTarget & { readonly source: string },
): Promise<Result<LuauConfigUpdate, PlanLuauConfigAliasError>> {
	const inspected = await deps.configLuauEditor(source, wanted);
	if (!inspected.success) {
		return { err: editorFailure(inspected.err, { path, wanted }), success: false };
	}

	const decision = decideLuauAlias(inspected.data.aliases, wanted);
	if (!decision.success) {
		const { err } = decision;
		return err.kind === "aliasConflict"
			? { err: { ...err, configPath: path }, success: false }
			: {
					err: uneditable(`its "${err.alias}" alias is not a string literal`, {
						path,
						wanted,
					}),
					success: false,
				};
	}

	return decision.data === "unchanged"
		? { data: { changed: false, content: source, path }, success: true }
		: { data: { changed: true, content: inspected.data.edited, path }, success: true };
}
