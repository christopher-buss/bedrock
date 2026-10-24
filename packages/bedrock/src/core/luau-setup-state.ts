import type { Result } from "@bedrock-rbx/ocale";

import { posix } from "node:path";

import { parseJsonObject } from "./parse-json-object.ts";

/**
 * Alias `bedrock setup` declares when neither a flag nor a prior run names
 * one.
 */
const BEDROCK_ALIAS = "bedrock";

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

/**
 * Pick the alias and types path for a setup run: a flag wins over what a
 * prior run recorded, which wins over the defaults. The types path is
 * normalized to `/` separators without redundant segments.
 *
 * @param recorded - What a prior run recorded, if anything.
 * @param overrides - Choices from the command line.
 * @returns The alias and types path to use.
 */
export function resolveLuauSetup(
	recorded: LuauSetupState | undefined,
	overrides: LuauSetupOverrides,
): LuauSetupState {
	const typesPath = overrides.typesPath ?? recorded?.typesPath ?? DEFAULT_LUAU_TYPES_PATH;
	return {
		alias: overrides.alias ?? recorded?.alias ?? BEDROCK_ALIAS,
		typesPath: posix.normalize(typesPath.replaceAll("\\", "/")),
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
