import {
	type EditMember,
	type EditValue,
	indentUnit,
	type Insertion,
	lineIndent,
	type Replacement,
	splice,
} from "./config-tree.ts";

/** How one brace syntax spells keys, values and separators. */
export interface BraceStyle {
	/** Render a key. */
	readonly key: (key: string) => string;
	/** Text between a key and its value. */
	readonly assign: string;
	/** Whether the syntax may spread an object over several lines. */
	readonly multiline: boolean;
	/** Whether a new multi-line object ends its last member with a comma. */
	readonly trailingComma: boolean;
}

/** A key that needs no quotes in TypeScript, JavaScript or Luau. */
export const IDENTIFIER = /^[A-Z_a-z][\w$]*$/;

/** Keys and values as JSON. */
export const JSON_STYLE: BraceStyle = {
	key: (key) => JSON.stringify(key),
	assign: ": ",
	multiline: true,
	trailingComma: false,
};

const LUAU_NAME = /^[A-Z_a-z]\w*$/;

/** Keys and values as a Luau table. */
export const LUAU_STYLE: BraceStyle = {
	key: (key) => (LUAU_NAME.test(key) ? key : `[${JSON.stringify(key)}]`),
	assign: " = ",
	multiline: true,
	trailingComma: true,
};

/** Keys and values as a YAML flow mapping, kept on one line. */
export const FLOW_STYLE: BraceStyle = { ...JSON_STYLE, multiline: false };

interface Layout {
	readonly indent: string;
	readonly style: BraceStyle;
	readonly trailing: boolean;
	readonly unit: string;
}

/**
 * Find the indentation unit of a brace-syntax file.
 * @param text - The file text.
 * @returns The unit, a tab for a file with no indented line.
 */
function braceUnit(text: string): string {
	return indentUnit(text, "\t");
}

const GAP = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)*/;

/**
 * Render a value on one line.
 * @param value - A scalar or a nested object.
 * @param style - The target syntax.
 * @returns The value's source text.
 */
export function inlineValue(value: EditValue, style: BraceStyle): string {
	if (typeof value !== "object") {
		return JSON.stringify(value);
	}

	const members = Object.entries(value).map(([key, field]) => inlineMember([key, field], style));
	return members.length === 0 ? "{}" : `{ ${members.join(", ")} }`;
}

/**
 * Render a member as text to paste by hand.
 * @param member - The key and value.
 * @param target - The file text, read for its indentation unit, and the
 * syntax to render.
 * @returns The member's source text, comma included when the style uses one.
 */
export function pasteMember(
	member: EditMember,
	{ style, text }: { readonly style: BraceStyle; readonly text: string },
): string {
	const layout = {
		indent: "",
		style,
		trailing: style.trailingComma,
		unit: braceUnit(text),
	};
	return `${blockMember(member, layout)}${style.trailingComma ? "," : ""}`;
}

/**
 * Write members at the end of a brace-delimited object, following the
 * object's own layout: one line, or one member per line with or without a
 * trailing comma.
 * @param insertion - The file text, the object and the new members.
 * @param style - The target syntax.
 * @returns The edited file text.
 */
export function insertBraceMembers(insertion: Insertion, style: BraceStyle): string {
	const { map, members, text } = insertion;
	const last = map.entries.at(-1);
	if (last === undefined) {
		return insertIntoEmpty(insertion, style);
	}

	const comma = commaAfter(text, last.end);
	const close = map.end - 1;
	const lineStart = text.lastIndexOf("\n", close - 1) + 1;
	if (!style.multiline || text.slice(lineStart, close).trim() !== "") {
		const inline = members.map((member) => inlineMember(member, style)).join(", ");
		return comma === -1
			? splice(text, { end: last.end, insert: `, ${inline}`, start: last.end })
			: splice(text, { end: comma + 1, insert: ` ${inline},`, start: comma + 1 });
	}

	const trailing = comma !== -1;
	const indent = lineIndent(text, last.start);
	const layout = { indent, style, trailing, unit: braceUnit(text) };
	const lines = members.map((member) => `${indent}${blockMember(member, layout)}`);
	const insert = `${lines.join(",\n")}${trailing ? "," : ""}\n`;
	const edited = splice(text, { end: lineStart, insert, start: lineStart });
	return trailing ? edited : splice(edited, { end: last.end, insert: ",", start: last.end });
}

/**
 * Replace a brace-delimited object with new fields on one line.
 * @param replacement - The file text, the object and the new fields.
 * @param style - The target syntax.
 * @returns The edited file text.
 */
export function replaceBraceObject({ fields, map, text }: Replacement, style: BraceStyle): string {
	return splice(text, { end: map.end, insert: inlineValue(fields, style), start: map.start });
}

/**
 * Render a member, spreading nested objects over indented lines. The first
 * line carries no indentation.
 * @param member - The key and value.
 * @param layout - Indentation and comma style.
 * @returns The member's source text.
 */
function blockMember([key, value]: EditMember, layout: Layout): string {
	const head = `${layout.style.key(key)}${layout.style.assign}`;
	if (typeof value !== "object" || Object.keys(value).length === 0) {
		return `${head}${inlineValue(value, layout.style)}`;
	}

	const inner = { ...layout, indent: `${layout.indent}${layout.unit}` };
	const body = Object.entries(value).map(
		(field) => `${inner.indent}${blockMember(field, inner)}`,
	);
	return `${head}{\n${body.join(",\n")}${layout.trailing ? "," : ""}\n${layout.indent}}`;
}

/**
 * Find the comma that ends a member, skipping whitespace and comments.
 * @param text - The file text.
 * @param offset - Offset one past the member.
 * @returns The comma's offset, or -1 when the member has none.
 */
function commaAfter(text: string, offset: number): number {
	const rest = text.slice(offset);
	const skipped = rest.length - rest.replace(GAP, "").length;
	return rest[skipped] === "," ? offset + skipped : -1;
}

function insertIntoEmpty({ map, members, text }: Insertion, style: BraceStyle): string {
	const range = { end: map.end - 1, start: map.start + 1 };
	if (!style.multiline) {
		const inline = members.map((member) => inlineMember(member, style));
		return splice(text, { ...range, insert: ` ${inline.join(", ")} ` });
	}

	const base = lineIndent(text, map.start);
	const unit = braceUnit(text);
	const layout = { indent: `${base}${unit}`, style, trailing: style.trailingComma, unit };
	const lines = members.map((member) => `${layout.indent}${blockMember(member, layout)}`);
	const trailing = style.trailingComma ? "," : "";
	return splice(text, { ...range, insert: `\n${lines.join(",\n")}${trailing}\n${base}` });
}

function inlineMember(member: EditMember, style: BraceStyle): string {
	return `${style.key(member[0])}${style.assign}${inlineValue(member[1], style)}`;
}
