import { parseYAML } from "confbox";

import {
	type ConfigEntry,
	type ConfigMap,
	type ConfigNode,
	type ConfigSyntax,
	type EditMember,
	indentUnit,
	type Insertion,
	lineIndent,
	OTHER,
	type Replacement,
	splice,
} from "./config-tree.ts";

interface BlockLayout {
	readonly indent: string;
	readonly unit: string;
}

/** One line that holds YAML content: not blank, not only a comment. */
interface Line {
	/** The line's text without indentation, trailing blanks or newline. */
	readonly content: string;
	/** Number of blanks before the content. */
	readonly indent: number;
	/** Offset of the next line, or the end of the text. */
	readonly next: number;
	/** Offset of the content's first character. */
	readonly start: number;
}

/** A key line and the lines that hold its value. */
interface Group {
	readonly children: Array<Line>;
	readonly head: Line;
	last: Line;
}

/**
 * A plain scalar the editor reads as a key and writes without quotes. Other
 * strings are quoted on write, and other keys make their mapping open.
 */
const PLAIN = String.raw`\w[\w./-]*(?: [\w./-]+)*`;

const PLAIN_TEXT = new RegExp(`^${PLAIN}$`);

/**
 * A key at the start of a line: plain, or quoted without escapes.
 */
const KEY = new RegExp(String.raw`^(?:${PLAIN}|"[^"\\]*"|'[^']*'):(?: |$)`);

const QUOTED = /^["']/;

const LINE = /[^\n]*\n?/g;

/**
 * Edits block YAML files. Flow collections, anchors, aliases, tags, block
 * scalars and keys other than plain or simply quoted ones are values the
 * editor does not follow, so an edit through them returns paste text.
 */
export const YAML_SYNTAX: ConfigSyntax = {
	insert: insertBlock,
	load: loadYaml,
	parse: parseYamlTree,
	paste(text, member) {
		return blockMembers([member], { indent: "", unit: yamlUnit(text) });
	},
	replace: replaceBlock,
} satisfies ConfigSyntax;

/**
 * Load YAML the way the config loader does.
 * @param text - The file text.
 * @returns The loaded value, or `undefined` when the text does not load.
 */
function loadYaml(text: string): unknown {
	try {
		return parseYAML(text);
	} catch {
		return undefined;
	}
}

function contentLines(text: string): Array<Line> {
	const lines: Array<Line> = [];
	for (const { 0: raw, index } of text.matchAll(LINE)) {
		const content = raw.trim();
		if (content !== "" && !content.startsWith("#")) {
			const indent = raw.length - raw.trimStart().length;
			lines.push({ content, indent, next: index + raw.length, start: index + indent });
		}
	}

	return lines;
}

/**
 * Split a block mapping's lines into one group per key line. A deeper line,
 * or a sequence line, belongs to the group above it.
 * @param first - The first line, which sets the keys' indentation.
 * @param lines - Every line of the mapping, the first included.
 * @returns The groups, in source order.
 */
function groupLines(first: Line, lines: ReadonlyArray<Line>): Array<Group> {
	const groups: Array<Group> = [];
	for (const line of lines) {
		const group = groups.at(-1);
		if (group !== undefined && (line.indent > first.indent || line.content.startsWith("-"))) {
			group.children.push(line);
			group.last = line;
		} else {
			groups.push({ children: [], head: line, last: line });
		}
	}

	return groups;
}

/**
 * Read a value: a mapping when the key line ends at the colon and lines
 * below hold the value, and any other value otherwise. A sequence below the
 * key reads as a mapping with no readable key, so it is open.
 * @param rest - The key line's text after the colon.
 * @param children - The lines below the key line that hold its value.
 * @returns A mapping, or the marker for any other value.
 */
function blockValue(rest: string, children: ReadonlyArray<Line>): ConfigNode {
	const [first] = children;
	const empty = rest === "" || rest.startsWith("#");
	return empty && first !== undefined ? scanMap(first, children) : OTHER;
}

/**
 * Read a block mapping.
 * @param first - The first line, which sets the keys' indentation.
 * @param lines - Every line of the mapping, the first included.
 * @returns The mapping, open when a key line cannot be read.
 */
function scanMap(first: Line, lines: ReadonlyArray<Line>): ConfigMap {
	const entries: Array<ConfigEntry> = [];
	let open = false;
	let end = first.next;
	for (const { children, head, last } of groupLines(first, lines)) {
		end = last.next;
		const match = KEY.exec(head.content);
		if (match === null) {
			open = true;
			continue;
		}

		const written = match[0].trimEnd().slice(0, -1);
		entries.push({
			key: QUOTED.test(written) ? written.slice(1, -1) : written,
			end: last.next,
			start: head.start,
			value: blockValue(head.content.slice(match[0].length).trimStart(), children),
		});
	}

	return { end, entries, kind: "map", open, start: first.start };
}

/**
 * Find the config mapping in YAML text.
 * @param text - The file text.
 * @returns The root mapping, or `undefined` when the text has no content.
 * Text that does not load fails the check after each write instead.
 */
function parseYamlTree(text: string): ConfigMap | undefined {
	const lines = contentLines(text);
	const [first] = lines;
	return first === undefined ? undefined : scanMap(first, lines);
}

/**
 * Find the indentation unit of a YAML file.
 * @param text - The file text.
 * @returns The unit, two spaces for a file with no indented line.
 */
function yamlUnit(text: string): string {
	return indentUnit(text, "  ");
}

function insertBlock({ map, members, text }: Insertion): string {
	const prefix = text[map.end - 1] === "\n" ? "" : "\n";
	const layout = { indent: lineIndent(text, map.start), unit: yamlUnit(text) };
	return splice(text, {
		end: map.end,
		insert: `${prefix}${blockMembers(members, layout)}\n`,
		start: map.end,
	});
}

function replaceBlock({ fields, map, text }: Replacement): string {
	const indent = lineIndent(text, map.start);
	const lines = blockMembers(Object.entries(fields), { indent, unit: yamlUnit(text) });
	const end = text[map.end - 1] === "\n" ? map.end - 1 : map.end;
	return splice(text, { end, insert: lines.slice(indent.length), start: map.start });
}

/**
 * Tell whether a string can be written without quotes: it has the plain
 * form the editor reads back as a key, and it loads as the same string both
 * as a key and as a value.
 * @param text - The string.
 * @returns True when no quotes are needed.
 */
function isPlain(text: string): boolean {
	return (
		PLAIN_TEXT.test(text) &&
		JSON.stringify(loadYaml(`${text}: ${text}`)) === JSON.stringify({ [text]: text })
	);
}

/**
 * Render a scalar. A string that is not plain is written double-quoted; a
 * JSON string is a valid YAML double-quoted scalar.
 * @param value - A string, number or boolean.
 * @returns The YAML source text.
 */
function scalar(value: boolean | number | string): string {
	return typeof value !== "string" || isPlain(value) ? String(value) : JSON.stringify(value);
}

/**
 * Render a member as block YAML lines. The first line carries no
 * indentation.
 * @param member - The key and value.
 * @param layout - Indentation of the member's own line and one level.
 * @returns The member's lines.
 */
function blockLines([key, value]: EditMember, layout: BlockLayout): Array<string> {
	if (typeof value !== "object") {
		return [`${scalar(key)}: ${scalar(value)}`];
	}

	const fields = Object.entries(value);
	if (fields.length === 0) {
		return [`${scalar(key)}: {}`];
	}

	return [
		`${scalar(key)}:`,
		blockMembers(fields, { ...layout, indent: `${layout.indent}${layout.unit}` }),
	];
}

function blockMembers(members: ReadonlyArray<EditMember>, layout: BlockLayout): string {
	return members
		.map((member) => `${layout.indent}${blockLines(member, layout).join("\n")}`)
		.join("\n");
}
