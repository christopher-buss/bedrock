import type { Result } from "@bedrock-rbx/ocale";

import { posix } from "node:path";

import { parseJsonObject } from "./parse-json-object.ts";

/**
 * Alias `bedrock setup` declares when neither a flag nor a prior run names
 * one.
 */
const BEDROCK_ALIAS = "bedrock";

/** File name the Luau types must have, so they load as `@<alias>/config`. */
export const LUAU_TYPES_FILE_NAME = "config.luau";

/** A Windows drive prefix such as `C:/`, after `\\` became `/`. */
const WINDOWS_DRIVE = /^[a-z]:\//i;

/**
 * Where `bedrock setup` writes the Luau types, relative to the project root.
 */
const DEFAULT_LUAU_TYPES_PATH = ".bedrock/config.luau";

/** Where `bedrock setup` records its choices, relative to the project root. */
export const LUAU_SETUP_STATE_PATH = ".bedrock/setup-state.json";

/** The alias and types path a `bedrock setup` run used. */
export interface LuauSetupState {
	/** Alias name, without the leading `@`. */
	readonly alias: string;
	/** Types file path, relative to the project root, with `/` separators. */
	readonly typesPath: string;
}

/** Choices passed to `bedrock setup` on the command line. */
export interface LuauSetupOverrides {
	/** Alias name from `--alias`. */
	readonly alias?: string | undefined;
	/** Types file path from `--types-path`, relative to the project root. */
	readonly typesPath?: string | undefined;
}

/** Why a recorded setup state cannot be read. */
export interface MalformedSetupStateError {
	/** Discriminant for a state file that cannot be read. */
	readonly kind: "malformedSetupState";
	/** What is wrong with the content. */
	readonly message: string;
}

/** Why a types path cannot be used. */
export interface InvalidTypesPathError {
	/**
	 * `absoluteTypesPath` for a path that is not relative to the project
	 * root, `typesPathOutsideProject` for one that climbs out of it with
	 * `..`, `typesFileNotConfig` for a file not named
	 * {@link LUAU_TYPES_FILE_NAME}.
	 */
	readonly kind: "absoluteTypesPath" | "typesFileNotConfig" | "typesPathOutsideProject";
	/** The types path as it was given. */
	readonly typesPath: string;
}

/**
 * Pick the alias and types path for a setup run: a flag wins over what a
 * prior run recorded, which wins over the defaults. The types path is
 * normalized to `/` separators without redundant segments, and must be
 * relative, stay inside the project root, and name a
 * {@link LUAU_TYPES_FILE_NAME} file so `require("@<alias>/config")` reaches
 * it.
 *
 * @param recorded - What a prior run recorded, if anything.
 * @param overrides - Choices from the command line.
 * @returns The alias and types path to use, or why the types path cannot
 *   be used.
 */
export function resolveLuauSetup(
	recorded: LuauSetupState | undefined,
	overrides: LuauSetupOverrides,
): Result<LuauSetupState, InvalidTypesPathError> {
	const given = overrides.typesPath ?? recorded?.typesPath ?? DEFAULT_LUAU_TYPES_PATH;
	const slashed = given.replaceAll("\\", "/");
	if (slashed.startsWith("/") || WINDOWS_DRIVE.test(slashed)) {
		return { err: { kind: "absoluteTypesPath", typesPath: given }, success: false };
	}

	const typesPath = posix.normalize(slashed);
	if (typesPath.startsWith("../")) {
		return { err: { kind: "typesPathOutsideProject", typesPath: given }, success: false };
	}

	if (typesPath.split("/").at(-1) !== LUAU_TYPES_FILE_NAME) {
		return { err: { kind: "typesFileNotConfig", typesPath: given }, success: false };
	}

	return {
		data: { alias: overrides.alias ?? recorded?.alias ?? BEDROCK_ALIAS, typesPath },
		success: true,
	};
}

/**
 * The directory alias target for a types file: the file's directory with a
 * trailing `/`, so `require("@alias/<file>")` reaches it.
 *
 * @param typesPath - Types file path relative to the project root.
 * @returns The `.luaurc` alias target.
 */
export function luauAliasTarget(typesPath: string): string {
	return `${posix.dirname(typesPath)}/`;
}

/**
 * Read a recorded setup state.
 *
 * @param content - The state file text, or `undefined` when it is absent.
 * @returns The recorded state, `undefined` when there is none, or why the
 *   content cannot be read.
 */
export function parseLuauSetupState(
	content: string | undefined,
): Result<LuauSetupState | undefined, MalformedSetupStateError> {
	if (content === undefined) {
		return { data: undefined, success: true };
	}

	const root = parseJsonObject(content);
	if (!root.success) {
		return malformed(root.err);
	}

	const { alias, typesPath } = root.data;
	if (typeof alias !== "string" || typeof typesPath !== "string") {
		return malformed('its "alias" and "typesPath" entries are not both strings');
	}

	if (alias === "") {
		return malformed('its "alias" entry is empty');
	}

	return { data: { alias, typesPath }, success: true };
}

/**
 * Format a setup state for writing.
 *
 * @param state - The state to record.
 * @returns The state file text.
 */
export function serializeLuauSetupState(state: LuauSetupState): string {
	return `${JSON.stringify({ alias: state.alias, typesPath: state.typesPath }, undefined, "\t")}\n`;
}

function malformed(message: string): Result<never, MalformedSetupStateError> {
	return { err: { kind: "malformedSetupState", message }, success: false };
}
