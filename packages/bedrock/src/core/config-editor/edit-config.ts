import { isDeepStrictEqual } from "node:util";

import { LUAU_STYLE, pasteMember } from "./brace-syntax.ts";
import {
	type ConfigMap,
	type ConfigSyntax,
	type EditFields,
	type EditMember,
	findEntry,
} from "./config-tree.ts";
import { JSON_SYNTAX, SCRIPT_SYNTAX } from "./script-syntax.ts";
import { YAML_SYNTAX } from "./yaml-syntax.ts";

/** One change to write into a config file. */
export type ConfigEdit = AddEntryEdit | DeclareImportEdit | UntrackEdit;

/** Input to {@link editConfigText}. */
export interface EditConfigInput {
	/** The edits, in write order. */
	readonly edits: ReadonlyArray<ConfigEdit>;
	/** The config file's name; its extension selects the syntax. */
	readonly fileName: string;
	/** The config file's text. */
	readonly text: string;
}

/** Output of {@link editConfigText}. */
export interface EditConfigResult {
	/** One outcome per edit, in input order. */
	readonly outcomes: ReadonlyArray<EditOutcome>;
	/** The file text with every written edit applied. */
	readonly text: string;
}

/** A root collection the import flow writes into. */
type EditCollection = "badges" | "passes" | "products";

/** Add a new root entry. Refused when the key already exists. */
interface AddEntryEdit {
	/** Key of the new entry. */
	readonly key: string;
	/** Collection that receives the entry. */
	readonly collection: EditCollection;
	/** The entry's fields, written in this order. */
	readonly entry: EditFields;
	/** Tells the edits apart. */
	readonly kind: "addEntry";
}

/**
 * Declare an import on one Environment's overlay entry, creating the overlay
 * entry and its parents when they are absent. Refused when the overlay entry
 * already sets `importId` or `iconBaseline`.
 */
interface DeclareImportEdit {
	/** Key of the entry that adopts the live item. */
	readonly key: string;
	/** Collection that holds the entry. */
	readonly collection: EditCollection;
	/** Environment whose overlay receives the lines. */
	readonly environment: string;
	/** Written when the icon file is the user's claim, not a verified copy. */
	readonly iconBaseline?: "accept-local-file";
	/** Roblox ID of the live item. */
	readonly importId: string;
	/** Tells the edits apart. */
	readonly kind: "declareImport";
}

/**
 * Replace an existing entry with `retired: "untrack"`: the root entry, or the
 * Environment's overlay entry when `environment` is set. Refused when the
 * entry does not exist.
 */
interface UntrackEdit {
	/** Key of the entry to untrack. */
	readonly key: string;
	/** Collection that holds the entry. */
	readonly collection: EditCollection;
	/**
	 * Environment whose overlay entry is replaced; the root entry if absent.
	 */
	readonly environment?: string;
	/** Tells the edits apart. */
	readonly kind: "untrack";
}

/** An edit written into the file. */
interface WrittenOutcome {
	/** The edit. */
	readonly edit: ConfigEdit;
	/** Tells the outcomes apart. */
	readonly status: "written";
}

/**
 * Why an edit was not written.
 *
 * - `notLiteral`: the edit's location is computed, or the file is Luau or a
 *   format the editor cannot parse.
 * - `conflict`: the file contradicts the edit (the key or field already
 *   exists, or the entry to untrack is absent).
 */
type NotSafeReason = "conflict" | "notLiteral";

/** Text to paste by hand, and the object to paste it into. */
interface PasteText {
	/** Path of the object that receives the text, from the config root. */
	readonly path: ReadonlyArray<string>;
	/** One member in the file's own syntax. */
	readonly text: string;
}

/** An edit left for the user to paste. */
interface NotSafeOutcome {
	/** The edit. */
	readonly edit: ConfigEdit;
	/** What to paste, and where. */
	readonly paste: PasteText;
	/** Why the edit was not written. */
	readonly reason: NotSafeReason;
	/** Tells the outcomes apart. */
	readonly status: "notSafe";
}

/** The result of one edit. */
type EditOutcome = NotSafeOutcome | WrittenOutcome;

interface Change {
	readonly key: string;
	readonly mode: "add" | "merge" | "replace";
	readonly path: ReadonlyArray<string>;
	readonly value: EditFields;
}

interface Context {
	readonly change: Change;
	readonly syntax: ConfigSyntax;
	readonly text: string;
}

type Applied = { readonly reason: NotSafeReason } | { readonly text: string };

/** A loaded config object, read and written by key. */
type LoadedObject = Record<string, unknown>;

/** A format the editor cannot parse: every edit is pasted, as JSON. */
const UNSUPPORTED_SYNTAX: ConfigSyntax = {
	...JSON_SYNTAX,
	parse() {
		// The format has no parser here, so no location counts as a literal.
	},
};

/** Luau config is evaluated, never parsed: every edit is pasted, as Luau. */
const LUAU_SYNTAX: ConfigSyntax = {
	...UNSUPPORTED_SYNTAX,
	paste: (text, member) => pasteMember(member, { style: LUAU_STYLE, text }),
};

const SYNTAXES: Readonly<Record<string, ConfigSyntax>> = {
	cjs: SCRIPT_SYNTAX,
	cts: SCRIPT_SYNTAX,
	js: SCRIPT_SYNTAX,
	json: JSON_SYNTAX,
	luau: LUAU_SYNTAX,
	mjs: SCRIPT_SYNTAX,
	mts: SCRIPT_SYNTAX,
	ts: SCRIPT_SYNTAX,
	yaml: YAML_SYNTAX,
	yml: YAML_SYNTAX,
};

/**
 * Write import-flow changes into a config file's text. Each edit is decided
 * on its own: it is written in place when every object on its path is a
 * literal, and otherwise returned with the text to paste by hand. Text
 * outside the written members is kept byte for byte.
 *
 * @param input - The file name, its text, and the edits in write order.
 * @returns The edited text and one outcome per edit.
 */
export function editConfigText({ edits, fileName, text }: EditConfigInput): EditConfigResult {
	const syntax = syntaxFor(fileName);
	const outcomes: Array<EditOutcome> = [];
	let current = text;
	for (const edit of edits) {
		const change = toChange(edit);
		const applied = applyChecked({ change, syntax, text: current });
		if ("text" in applied) {
			current = applied.text;
			outcomes.push({ edit, status: "written" });
			continue;
		}

		const paste = {
			path: change.path,
			text: syntax.paste(current, [change.key, change.value]),
		};
		outcomes.push({ edit, paste, reason: applied.reason, status: "notSafe" });
	}

	return { outcomes, text: current };
}

function syntaxFor(fileName: string): ConfigSyntax {
	const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
	return SYNTAXES[extension] ?? UNSUPPORTED_SYNTAX;
}

function toChange(edit: ConfigEdit): Change {
	switch (edit.kind) {
		case "addEntry": {
			return { key: edit.key, mode: "add", path: [edit.collection], value: edit.entry };
		}
		case "declareImport": {
			const { key, collection, environment, iconBaseline, importId } = edit;
			return {
				key,
				mode: "merge",
				path: ["environments", environment, collection],
				value: iconBaseline === undefined ? { importId } : { iconBaseline, importId },
			};
		}
		case "untrack": {
			const { key, collection, environment } = edit;
			const path =
				environment === undefined
					? [collection]
					: ["environments", environment, collection];
			return { key, mode: "replace", path, value: { retired: "untrack" } };
		}
	}
}

function nest(path: ReadonlyArray<string>, member: EditMember): EditMember {
	return path.reduceRight<EditMember>((inner, key) => [key, { [inner[0]]: inner[1] }], member);
}

function writeAt({ change, syntax, text }: Context, map: ConfigMap): Applied {
	const entry = findEntry(map, change.key);
	if (entry === undefined) {
		return change.mode === "replace"
			? { reason: "conflict" }
			: { text: syntax.insert({ map, members: [[change.key, change.value]], text }) };
	}

	if (change.mode === "add") {
		return { reason: "conflict" };
	}

	const target = entry.value;
	if (target.kind !== "map" || target.open) {
		return { reason: "notLiteral" };
	}

	if (change.mode === "replace") {
		return { text: syntax.replace({ fields: change.value, map: target, text }) };
	}

	const members = Object.entries(change.value);
	return members.some(([field]) => findEntry(target, field) !== undefined)
		? { reason: "conflict" }
		: { text: syntax.insert({ map: target, members, text }) };
}

function apply(context: Context): Applied {
	const { change, syntax, text } = context;
	let map = syntax.parse(text);
	for (const [index, segment] of change.path.entries()) {
		if (map === undefined || map.open) {
			return { reason: "notLiteral" };
		}

		const entry = findEntry(map, segment);
		if (entry === undefined) {
			if (change.mode === "replace") {
				return { reason: "conflict" };
			}

			const member = nest(change.path.slice(index + 1), [change.key, change.value]);
			return {
				text: syntax.insert({
					map,
					members: [[segment, { [member[0]]: member[1] }]],
					text,
				}),
			};
		}

		map = entry.value.kind === "map" ? entry.value : undefined;
	}

	return map === undefined || map.open ? { reason: "notLiteral" } : writeAt(context, map);
}

function isLoadedObject(value: unknown): value is LoadedObject {
	return value instanceof Object;
}

/**
 * Read a loaded value as an object.
 * @param value - A loaded value, or `undefined` for a missing key.
 * @returns The value, or a new empty object when it is not an object.
 */
function objectAt(value: unknown): LoadedObject {
	return isLoadedObject(value) ? value : {};
}

/**
 * Apply a change to a loaded config value.
 * @param loaded - The file's value before the change.
 * @param change - The key, path, mode and fields to write.
 * @returns The value the edited file must load to.
 */
function expectedValue(loaded: unknown, { key, mode, path, value }: Change): LoadedObject {
	const root = objectAt(structuredClone(loaded));
	let target = root;
	for (const segment of path) {
		const next = objectAt(target[segment]);
		target[segment] = next;
		target = next;
	}

	target[key] = mode === "replace" ? value : { ...objectAt(target[key]), ...value };
	return root;
}

/**
 * Apply a change, and keep the written text only when the syntax can load
 * it and it loads to the value the change expects.
 * @param context - The change, the syntax and the file text.
 * @returns The edited text, or why the change was not written.
 */
function applyChecked(context: Context): Applied {
	const applied = apply(context);
	const { load } = context.syntax;
	if (load === undefined || !("text" in applied)) {
		return applied;
	}

	const expected = expectedValue(load(context.text), context.change);
	return isDeepStrictEqual(load(applied.text), expected) ? applied : { reason: "notLiteral" };
}
