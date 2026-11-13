import {
	type Argument,
	type ExportDefaultDeclarationKind,
	type ObjectExpression,
	type ObjectPropertyKind,
	parseSync,
	type Program,
} from "oxc-parser";

import {
	type BraceStyle,
	IDENTIFIER,
	insertBraceMembers,
	JSON_STYLE,
	pasteMember,
	replaceBraceObject,
} from "./brace-syntax.ts";
import { type ConfigEntry, type ConfigMap, type ConfigSyntax, OTHER } from "./config-tree.ts";

/** A node that may hold the config object, before wrappers are removed. */
type Candidate = Argument | ExportDefaultDeclarationKind;

/** The file name the parser reads its language from: TypeScript. */
const PARSE_NAME = "bedrock.config.ts";

/** Keys and values as TypeScript or JavaScript source. */
const SCRIPT_STYLE: BraceStyle = {
	key: (key) => (IDENTIFIER.test(key) ? key : JSON.stringify(key)),
	assign: ": ",
	trailingComma: true,
};

/**
 * Edits TypeScript or JavaScript config files: the object a module exports
 * by default or assigns to `module.exports`, directly, through
 * `defineConfig`, or through a top-level `const`. JavaScript parses as
 * TypeScript.
 */
export const SCRIPT_SYNTAX: ConfigSyntax = {
	insert: (insertion) => insertBraceMembers(insertion, SCRIPT_STYLE),
	parse: parseScript,
	paste: (text, member) => pasteMember(member, { style: SCRIPT_STYLE, text }),
	replace: (replacement) => replaceBraceObject(replacement, SCRIPT_STYLE),
};

function innerNode(node: Candidate): Candidate | undefined {
	if (
		node.type === "ParenthesizedExpression" ||
		node.type === "TSAsExpression" ||
		node.type === "TSSatisfiesExpression"
	) {
		return node.expression;
	}

	const isDefine =
		node.type === "CallExpression" &&
		node.callee.type === "Identifier" &&
		node.callee.name === "defineConfig";
	return isDefine ? node.arguments[0] : undefined;
}

/**
 * Remove what wraps a config object without changing it: parentheses,
 * `as` and `satisfies`, and a `defineConfig` call.
 * @param node - The node to unwrap.
 * @returns The innermost node.
 */
function unwrap(node: Candidate): Candidate {
	let current = node;
	let inner = innerNode(current);
	while (inner !== undefined) {
		current = inner;
		inner = innerNode(current);
	}

	return current;
}

/**
 * Follow an exported name to the top-level `const` that declares it.
 * @param program - The parsed module.
 * @param node - The exported node.
 * @returns The declaration's value without wrappers, or the node itself.
 */
function resolveConstant(program: Program, node: Candidate): Candidate {
	if (node.type !== "Identifier") {
		return node;
	}

	const declarator = program.body
		.flatMap((statement) => {
			return statement.type === "VariableDeclaration" && statement.kind === "const"
				? statement.declarations
				: [];
		})
		.find(({ id }) => id.type === "Identifier" && id.name === node.name);
	return declarator?.init ? unwrap(declarator.init) : node;
}

function exportedConfig(program: Program, text: string): Candidate | undefined {
	for (const statement of program.body) {
		if (statement.type === "ExportDefaultDeclaration") {
			return statement.declaration;
		}

		if (
			statement.type === "ExpressionStatement" &&
			statement.expression.type === "AssignmentExpression" &&
			text.slice(statement.expression.left.start, statement.expression.left.end) ===
				"module.exports"
		) {
			return statement.expression.right;
		}
	}

	return undefined;
}

function parseScript(text: string): ConfigMap | undefined {
	const { errors, program } = parseSync(PARSE_NAME, text);
	const exported = errors.length === 0 ? exportedConfig(program, text) : undefined;
	if (exported === undefined) {
		return undefined;
	}

	const config = resolveConstant(program, unwrap(exported));
	return config.type === "ObjectExpression" ? toMap(config, 0) : undefined;
}

/**
 * Edits JSON files. The text parses as one parenthesized expression, and the
 * offsets are moved back over the added parenthesis.
 */
export const JSON_SYNTAX: ConfigSyntax = {
	insert: (insertion) => insertBraceMembers(insertion, JSON_STYLE),
	parse: parseJson,
	paste: (text, member) => pasteMember(member, { style: JSON_STYLE, text }),
	replace: (replacement) => replaceBraceObject(replacement, JSON_STYLE),
};

function parseJson(text: string): ConfigMap | undefined {
	// A syntax error leaves the program empty.
	const { program } = parseSync(PARSE_NAME, `(${text}\n)`);
	const [statement] = program.body;
	if (
		statement?.type !== "ExpressionStatement" ||
		statement.expression.type !== "ParenthesizedExpression" ||
		statement.expression.expression.type !== "ObjectExpression"
	) {
		return undefined;
	}

	return toMap(statement.expression.expression, -1);
}

function toEntry(property: ObjectPropertyKind, shift: number): ConfigEntry | undefined {
	if (property.type === "SpreadElement") {
		return undefined;
	}

	const { key } = property;
	if (property.computed || (key.type !== "Identifier" && key.type !== "Literal")) {
		return undefined;
	}

	const value = unwrap(property.value);
	return {
		key: key.type === "Identifier" ? key.name : String(key.value),
		end: property.end + shift,
		start: property.start + shift,
		value: value.type === "ObjectExpression" ? toMap(value, shift) : OTHER,
	};
}

/**
 * Read an object expression's literal members.
 * @param object - The parsed object.
 * @param shift - Added to every offset, for text parsed with a prefix.
 * @returns The object with offsets into the original text.
 */
function toMap(object: ObjectExpression, shift: number): ConfigMap {
	const entries = object.properties.map((property) => toEntry(property, shift));
	const literal = entries.filter((entry) => entry !== undefined);
	return {
		end: object.end + shift,
		entries: literal,
		kind: "map",
		open: literal.length < entries.length,
		start: object.start + shift,
	};
}
