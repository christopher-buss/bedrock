/** A value the config editor can write: a scalar or a nested literal object. */
export type EditValue = boolean | number | string | { readonly [key: string]: EditValue };

/** The fields of one written object, in write order. */
export type EditFields = Readonly<Record<string, EditValue>>;

/** One key and its value, written as a single member of an object. */
export type EditMember = readonly [key: string, value: EditValue];

/**
 * A literal object found in a config file, with the source offsets an edit
 * needs.
 */
export interface ConfigMap {
	/** Offset one past the object's last character. */
	readonly end: number;
	/** The literal members, in source order. */
	readonly entries: ReadonlyArray<ConfigEntry>;
	/** Tells a literal object from any other value. */
	readonly kind: "map";
	/**
	 * True when a member's key is not a literal (a spread, a computed key, a
	 * YAML merge key), so no key can be added or read safely.
	 */
	readonly open: boolean;
	/** Offset of the object's first character. */
	readonly start: number;
}

/**
 * A value that is not a literal object: a scalar or any computed expression.
 */
export interface ConfigOther {
	/** Tells any other value from a literal object. */
	readonly kind: "other";
}

/** A member value inside a parsed config file. */
export type ConfigNode = ConfigMap | ConfigOther;

/** One literal member of a {@link ConfigMap}. */
export interface ConfigEntry {
	/** The member's key as written, without quotes. */
	readonly key: string;
	/** Offset one past the member's value. */
	readonly end: number;
	/** Offset of the member's key. */
	readonly start: number;
	/** The member's value. */
	readonly value: ConfigNode;
}

/** Members to write at the end of an object. */
export interface Insertion {
	/** The object that receives the members. */
	readonly map: ConfigMap;
	/** The new members, in write order. */
	readonly members: ReadonlyArray<EditMember>;
	/** The file text. */
	readonly text: string;
}

/** Fields that replace a whole object. */
export interface Replacement {
	/** The new fields, in write order. */
	readonly fields: EditFields;
	/** The object to replace. */
	readonly map: ConfigMap;
	/** The file text. */
	readonly text: string;
}

/** A range of text and what replaces it. */
export interface Splice {
	/** Offset one past the last replaced character. */
	readonly end: number;
	/** The new text. */
	readonly insert: string;
	/** First offset to replace. */
	readonly start: number;
}

/**
 * What the editor needs from one config syntax: a parser that finds the
 * config object, and the text splices that write into it.
 */
export interface ConfigSyntax {
	/**
	 * Write members at the end of an object.
	 * @returns The edited file text.
	 */
	readonly insert: (insertion: Insertion) => string;
	/**
	 * Read a file the way the config loader reads it. When set, an edit is
	 * written only when the edited file loads to the value the edit expects.
	 * @returns The loaded value, or `undefined` when the file does not load.
	 */
	readonly load?: (text: string) => unknown;
	/**
	 * Find the config object in a file.
	 * @returns The root object, or `undefined` when the file has no literal
	 * config object.
	 */
	readonly parse: (text: string) => ConfigMap | undefined;
	/**
	 * Render one member as text to paste into an object by hand.
	 * @returns The member's source text.
	 */
	readonly paste: (text: string, member: EditMember) => string;
	/**
	 * Replace an object with new fields.
	 * @returns The edited file text.
	 */
	readonly replace: (replacement: Replacement) => string;
}

export const OTHER: ConfigOther = { kind: "other" };

const INDENTED_LINE = /^([\t ]+)\S/m;
const LEADING_BLANKS = /^[\t ]*/;

/**
 * Find a member by key.
 * @param map - The object to search.
 * @param key - The member key.
 * @returns The first member with that key, or `undefined`.
 */
export function findEntry(map: ConfigMap, key: string): ConfigEntry | undefined {
	return map.entries.find((entry) => entry.key === key);
}

/**
 * Find the indentation unit a file uses: the leading whitespace of its first
 * indented line.
 * @param text - The file text.
 * @param fallback - The unit for a file with no indented line.
 * @returns The indentation unit.
 */
export function indentUnit(text: string, fallback: string): string {
	return INDENTED_LINE.exec(text)?.[1] ?? fallback;
}

/**
 * Read the leading whitespace of the line that holds an offset.
 * @param text - The file text.
 * @param offset - Any offset on the line.
 * @returns The line's indentation.
 */
export function lineIndent(text: string, offset: number): string {
	const line = text.slice(text.lastIndexOf("\n", offset) + 1);
	return line.slice(0, line.length - line.replace(LEADING_BLANKS, "").length);
}

/**
 * Replace a range of text.
 * @param text - The source text.
 * @param edit - The range and its new text.
 * @returns The edited text.
 */
export function splice(text: string, { end, insert, start }: Splice): string {
	return `${text.slice(0, start)}${insert}${text.slice(end)}`;
}
