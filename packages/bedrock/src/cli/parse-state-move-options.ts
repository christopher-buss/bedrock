import type { Result } from "@bedrock-rbx/ocale";

import { type CommonOptions, parseCommonOptions, type ParseOptionsError } from "./parse-options.ts";

/**
 * Typed shape the `state move` command consumes once its own flags have
 * been validated and the rest handed to the common parser.
 */
export interface StateMoveOptions {
	/** The flags every subcommand shares. */
	readonly common: CommonOptions;
	/**
	 * Destination coordinates keyed by the field each one answers, read off
	 * the `--to-<key>` flags. Empty when the flags named none, which is what
	 * sends the command to its prompts.
	 */
	readonly coordinates: Readonly<Record<string, string>>;
	/** Whether to survey the move and write nothing. */
	readonly dryRun: boolean;
	/** Whether to overwrite a destination that already holds state. */
	readonly force: boolean;
	/**
	 * Name of the **Backend** to move onto, or `undefined` when the flags
	 * named none.
	 */
	readonly to: string | undefined;
}

/** Where the flags said the state should land. */
interface ParsedDestination {
	/** Coordinates keyed by the field each one answers. */
	readonly coordinates: Readonly<Record<string, string>>;
	/** **Backend** the coordinates address, absent when none was named. */
	readonly to: string | undefined;
}

/** The two switches, once both have been read. */
interface ParsedSwitches {
	/** Whether to survey the move and write nothing. */
	readonly dryRun: boolean;
	/** Whether to overwrite a destination that already holds state. */
	readonly force: boolean;
}

/** One flag's raw key paired with the value sade parsed for it. */
type RawEntry = readonly [string, unknown];

/** Prefix marking a flag as one destination coordinate. */
const COORDINATE_PREFIX = "to-";

/** Flags this parser owns, which the common parser never sees. */
const OWN_FLAGS: ReadonlySet<string> = new Set(["dry-run", "dryRun", "force", "to"]);

/**
 * Translate the raw sade options POJO into a typed `StateMoveOptions`.
 *
 * The destination's coordinates arrive as `--to-<key>` flags whose keys are
 * the fields the destination **Backend** declares, so a **Backend** that
 * ships later is addressable without this parser learning its name. They
 * are validated for shape here and against the **Backend**'s own schema
 * once the project has loaded and named it.
 *
 * @param rawOptions - The options object sade hands the action callback.
 * @param getEnvironment - Reads an environment variable, forwarded to the
 *   common parser for its `--env` fallback.
 * @returns `Ok(StateMoveOptions)` on success, or `Err(ParseOptionsError)`
 *   naming the offending flag.
 */
export function parseStateMoveOptions(
	rawOptions: Readonly<Record<string, unknown>>,
	getEnvironment?: (name: string) => string | undefined,
): Result<StateMoveOptions, ParseOptionsError> {
	const entries = Object.entries(rawOptions);
	const common = parseCommonOptions(
		Object.fromEntries(entries.filter(([key]) => !isOwnFlag(key))),
		getEnvironment,
	);
	if (!common.success) {
		return common;
	}

	const destination = readDestination(rawOptions, entries);
	if (!destination.success) {
		return destination;
	}

	const switches = readSwitches(rawOptions);
	if (!switches.success) {
		return switches;
	}

	return {
		data: { common: common.data, ...destination.data, ...switches.data },
		success: true,
	};
}

function isOwnFlag(key: string): boolean {
	return OWN_FLAGS.has(key) || key.startsWith(COORDINATE_PREFIX);
}

/**
 * Read the coordinate flags, refusing one that names no key or carries no
 * value.
 *
 * @param entries - Every flag sade parsed, keyed as it was written.
 * @returns The coordinates keyed by field, or the offending flag.
 */
function readCoordinates(
	entries: ReadonlyArray<RawEntry>,
): Result<Readonly<Record<string, string>>, ParseOptionsError> {
	let coordinates: Readonly<Record<string, string>> = {};
	for (const [flag, value] of entries) {
		if (!flag.startsWith(COORDINATE_PREFIX)) {
			continue;
		}

		const key = flag.slice(COORDINATE_PREFIX.length);
		if (key === "" || typeof value !== "string" || value === "") {
			return { err: { flag, kind: "invalidValue" }, success: false };
		}

		coordinates = { ...coordinates, [key]: value };
	}

	return { data: coordinates, success: true };
}

/**
 * Read the destination the flags named, refusing coordinates supplied for
 * a **Backend** nothing named: they would reach a store the command never
 * built.
 *
 * @param rawOptions - The options object sade hands the action callback.
 * @param entries - The same options as entries, for the coordinate scan.
 * @returns The named **Backend** and its coordinates, or the offending flag.
 */
function readDestination(
	rawOptions: Readonly<Record<string, unknown>>,
	entries: ReadonlyArray<RawEntry>,
): Result<ParsedDestination, ParseOptionsError> {
	const raw = rawOptions["to"];
	if (raw !== undefined && (typeof raw !== "string" || raw === "")) {
		return { err: { flag: "to", kind: "invalidValue" }, success: false };
	}

	const coordinates = readCoordinates(entries);
	if (!coordinates.success) {
		return coordinates;
	}

	if (raw === undefined && Object.keys(coordinates.data).length > 0) {
		return { err: { flag: "to", kind: "missingRequired" }, success: false };
	}

	return { data: { coordinates: coordinates.data, to: raw }, success: true };
}

/**
 * Read one switch, accepting every spelling sade may hand it back under and
 * reporting the failure against the flag as it is documented.
 *
 * @param rawOptions - The options object sade hands the action callback.
 * @param keys - The spellings to look under, documented spelling first.
 * @returns Whether the switch is on, defaulting to off when absent.
 */
function readSwitch(
	rawOptions: Readonly<Record<string, unknown>>,
	keys: readonly [string, ...ReadonlyArray<string>],
): Result<boolean, ParseOptionsError> {
	for (const key of keys) {
		const raw = rawOptions[key];
		if (raw === undefined) {
			continue;
		}

		if (typeof raw !== "boolean") {
			return { err: { flag: keys[0], kind: "invalidValue" }, success: false };
		}

		return { data: raw, success: true };
	}

	return { data: false, success: true };
}

/**
 * Read both switches.
 *
 * @param rawOptions - The options object sade hands the action callback.
 * @returns Whether each switch is on, or the offending flag.
 */
function readSwitches(
	rawOptions: Readonly<Record<string, unknown>>,
): Result<ParsedSwitches, ParseOptionsError> {
	const dryRun = readSwitch(rawOptions, ["dry-run", "dryRun"]);
	if (!dryRun.success) {
		return dryRun;
	}

	const force = readSwitch(rawOptions, ["force"]);
	if (!force.success) {
		return force;
	}

	return { data: { dryRun: dryRun.data, force: force.data }, success: true };
}
