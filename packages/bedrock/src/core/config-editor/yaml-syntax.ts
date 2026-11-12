import { isMap, isScalar, type ParsedNode, parseDocument, stringify, type YAMLMap } from "yaml";

import {
	type BraceStyle,
	FLOW_STYLE,
	insertBraceMembers,
	pasteMember,
	replaceBraceObject,
} from "./brace-syntax.ts";
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
	splice,
} from "./config-tree.ts";

interface BlockLayout {
	readonly indent: string;
	readonly unit: string;
}

/** Edits YAML files, block or flow. */
export const YAML_SYNTAX = yamlSyntax(FLOW_STYLE);

/**
 * Find the config mapping in YAML or JSON text.
 * @param text - The file text.
 * @returns The root mapping, or `undefined` when the text does not parse or
 * its root is not a mapping.
 */
export function parseYamlTree(text: string): ConfigMap | undefined {
	const document = parseDocument(text);
	if (document.errors.length > 0 || !isMap(document.contents)) {
		return undefined;
	}

	return toMap(document.contents);
}

/**
 * Edit JSON files, which parse as YAML flow mappings but render as JSON.
 * @param style - How the JSON is written.
 * @returns A syntax that parses with the YAML parser and pastes JSON.
 */
export function jsonSyntax(style: BraceStyle): ConfigSyntax {
	return {
		...yamlSyntax(style),
		paste: (text, member) => pasteMember(member, { style, text }),
	};
}

/**
 * Find the indentation unit of a YAML file.
 * @param text - The file text.
 * @returns The unit, two spaces for a file with no indented line.
 */
function yamlUnit(text: string): string {
	return indentUnit(text, "  ");
}

/**
 * Find where a line can start after a block mapping. A mapping that ends the
 * file without a newline gets one first.
 * @param text - The file text.
 * @param offset - Offset one past the mapping's content.
 * @returns The insertion offset and the text to write before the new lines.
 */
function lineAfter(text: string, offset: number): { prefix: string; start: number } {
	return { prefix: text[offset - 1] === "\n" ? "" : "\n", start: offset };
}

function insertBlock({ map, members, text }: Insertion): string {
	const { prefix, start } = lineAfter(text, map.end);
	const layout = { indent: lineIndent(text, map.start), unit: yamlUnit(text) };
	return splice(text, {
		end: start,
		insert: `${prefix}${blockMembers(members, layout)}\n`,
		start,
	});
}

function yamlSyntax(style: BraceStyle): ConfigSyntax {
	return {
		insert(insertion) {
			return insertion.map.flow
				? insertBraceMembers(insertion, style)
				: insertBlock(insertion);
		},
		parse: parseYamlTree,
		paste(text, member) {
			return blockMembers([member], { indent: "", unit: yamlUnit(text) });
		},
		replace(replacement) {
			const { fields, map, text } = replacement;
			if (map.flow) {
				return replaceBraceObject(replacement, style);
			}

			const indent = lineIndent(text, map.start);
			const lines = blockMembers(Object.entries(fields), {
				indent,
				unit: yamlUnit(text),
			});
			const end = text[map.end - 1] === "\n" ? map.end - 1 : map.end;
			return splice(text, { end, insert: lines.slice(indent.length), start: map.start });
		},
	};
}

function toNode(node: null | ParsedNode): ConfigNode {
	return isMap(node) && node.anchor === undefined ? toMap(node) : OTHER;
}

function toMap(map: YAMLMap.Parsed): ConfigMap {
	const entries: Array<ConfigEntry> = [];
	let open = false;
	for (const { key, value } of map.items) {
		if (!isScalar(key) || key.value === "<<") {
			open = true;
			continue;
		}

		const [start, keyEnd] = key.range;
		const end = value === null ? keyEnd : value.range[1];
		entries.push({ key: String(key.value), end, start, value: toNode(value) });
	}

	const [start, end] = map.range;
	return { end, entries, flow: map.flow === true, kind: "map", open, start };
}

function scalar(value: boolean | number | string): string {
	return stringify(value, { lineWidth: 0 }).trimEnd();
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
