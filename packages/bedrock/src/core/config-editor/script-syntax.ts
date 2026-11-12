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
	pasteMember,
	replaceBraceObject,
} from "./brace-syntax.ts";
import { type ConfigEntry, type ConfigMap, type ConfigSyntax, OTHER } from "./config-tree.ts";

/** A node that may hold the config object, before wrappers are removed. */
type Candidate = Argument | ExportDefaultDeclarationKind;

/** Keys and values as TypeScript or JavaScript source. */
const SCRIPT_STYLE: BraceStyle = {
	key: (key) => (IDENTIFIER.test(key) ? key : JSON.stringify(key)),
	assign: ": ",
	multiline: true,
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
	const { errors, program } = parseSync("bedrock.config.ts", text);
	const exported = errors.length === 0 ? exportedConfig(program, text) : undefined;
	if (exported === undefined) {
		return undefined;
	}

	const config = resolveConstant(program, unwrap(exported));
	return config.type === "ObjectExpression" ? toMap(config) : undefined;
}

function toEntry(property: ObjectPropertyKind): ConfigEntry | undefined {
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
		end: property.end,
		start: property.start,
		value: value.type === "ObjectExpression" ? toMap(value) : OTHER,
	};
}

function toMap(object: ObjectExpression): ConfigMap {
	const entries = object.properties.map(toEntry);
	const literal = entries.filter((entry) => entry !== undefined);
	return {
		end: object.end,
		entries: literal,
		kind: "map",
		open: literal.length < entries.length,
		start: object.start,
	};
}
