import path from "node:path";
import ts from "typescript";

/**
 * A public-API symbol reached from a package barrel, paired with the
 * `@since` version recorded on its declaration (if any).
 */
export interface PublicApiSymbol {
	/** Exported name as seen at the barrel. */
	readonly name: string;
	/** Absolute path to the file where the symbol is declared. */
	readonly declarationFile: string;
	/** Version from the declaration's `@since` JSDoc tag, or `undefined`. */
	readonly sinceTag: string | undefined;
}

/**
 * Reads a module's TypeScript source given its absolute path. Injected so the
 * walker can be unit-tested against an in-memory module map instead of disk.
 */
export type ReadSource = (absolutePath: string) => string;

interface DeclarationRequest {
	readonly name: string;
	readonly modulePath: string;
}

interface ResolvedDeclaration {
	readonly declarationFile: string;
	readonly sinceTag: string | undefined;
}

/**
 * Walk a package barrel and return every first-party public symbol it
 * re-exports, resolved to the declaration that actually defines it. Each
 * `export { … } from "./relative.ts"` is followed to its source module; the
 * returned `declarationFile` points at that module, not the barrel.
 *
 * @param barrelPath - Absolute path to the barrel (e.g. A package `index.ts`).
 * @param readSource - Reads a module's source by absolute path.
 * @returns One entry per re-exported name, in barrel order.
 */
export function collectPublicApiSymbols(
	barrelPath: string,
	readSource: ReadSource,
): Array<PublicApiSymbol> {
	const symbols: Array<PublicApiSymbol> = [];
	const barrel = parseModule(barrelPath, readSource);

	for (const statement of barrel.statements) {
		if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) {
			continue;
		}

		const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
		if (!isRelativeSpecifier(specifier)) {
			continue;
		}

		const targetPath = path.resolve(path.dirname(barrelPath), specifier);

		for (const element of namedExportElements(statement)) {
			const lookupName = (element.propertyName ?? element.name).text;
			const resolved = resolveDeclaration(
				{ name: lookupName, modulePath: targetPath },
				readSource,
			);
			if (resolved !== undefined) {
				symbols.push({ ...resolved, name: element.name.text });
			}
		}
	}

	return symbols;
}

/**
 * Resolve the absolute paths of every first-party barrel a package publishes:
 * each `exports` entry whose `source` condition points at a `./src/**` `.ts`
 * module. Subpaths that ship from outside `src` (the `./testing` helpers, a
 * bare `./package.json`) are excluded.
 *
 * @param packageJsonText - Raw `package.json` contents.
 * @param packageRoot - Absolute path the relative sources resolve against.
 * @returns Absolute barrel paths, in `exports` declaration order.
 */
export function barrelSourcePaths(packageJsonText: string, packageRoot: string): Array<string> {
	const manifest = JSON.parse(packageJsonText);
	const exportsMap = readObject(manifest)?.["exports"];
	const entries = readObject(exportsMap);
	if (entries === undefined) {
		return [];
	}

	const paths: Array<string> = [];
	for (const entry of Object.values(entries)) {
		const source = sourceConditionOf(entry);
		if (source !== undefined && source.startsWith("./src/") && source.endsWith(".ts")) {
			paths.push(path.resolve(packageRoot, source));
		}
	}

	return paths;
}

function parseModule(modulePath: string, readSource: ReadSource): ts.SourceFile {
	return ts.createSourceFile(
		modulePath,
		readSource(modulePath),
		ts.ScriptTarget.Latest,
		false,
		ts.ScriptKind.TS,
	);
}

function namedExportElements(statement: ts.ExportDeclaration): ReadonlyArray<ts.ExportSpecifier> {
	const clause = statement.exportClause;
	if (clause === undefined || !ts.isNamedExports(clause)) {
		return [];
	}

	return clause.elements;
}

function isRelativeSpecifier(specifier: string): boolean {
	return specifier.startsWith(".");
}

function readObject(value: JSONValue): Record<string, JSONValue> | undefined {
	if (typeof value === "object" && value && !Array.isArray(value)) {
		return value;
	}

	return undefined;
}

function sourceConditionOf(entry: JSONValue): string | undefined {
	const record = readObject(entry);
	const source = record?.["source"];
	return typeof source === "string" ? source : undefined;
}

const SINCE_TAG = /@since\s+(\S+)/;

function sinceTagOf(module: ts.SourceFile, statement: ts.Statement): string | undefined {
	const ranges = ts.getLeadingCommentRanges(module.text, statement.getFullStart()) ?? [];
	for (const range of ranges) {
		const match = SINCE_TAG.exec(module.text.slice(range.pos, range.end));
		if (match?.[1] !== undefined) {
			return match[1];
		}
	}

	return undefined;
}

function declaresName(statement: ts.Statement, name: string): boolean {
	if (
		ts.isFunctionDeclaration(statement) ||
		ts.isClassDeclaration(statement) ||
		ts.isInterfaceDeclaration(statement) ||
		ts.isTypeAliasDeclaration(statement) ||
		ts.isEnumDeclaration(statement)
	) {
		return statement.name?.text === name;
	}

	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.some((declaration) => {
			return ts.isIdentifier(declaration.name) && declaration.name.text === name;
		});
	}

	return false;
}

function reExportTargetFor(
	module: ts.SourceFile,
	name: string,
): undefined | { name: string; specifier: string } {
	for (const statement of module.statements) {
		if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) {
			continue;
		}

		for (const element of namedExportElements(statement)) {
			if (element.name.text === name) {
				return {
					name: (element.propertyName ?? element.name).text,
					specifier: (statement.moduleSpecifier as ts.StringLiteral).text,
				};
			}
		}
	}

	return undefined;
}

function resolveDeclaration(
	request: DeclarationRequest,
	readSource: ReadSource,
): ResolvedDeclaration | undefined {
	const module = parseModule(request.modulePath, readSource);

	for (const statement of module.statements) {
		if (declaresName(statement, request.name)) {
			return {
				declarationFile: request.modulePath,
				sinceTag: sinceTagOf(module, statement),
			};
		}
	}

	const next = reExportTargetFor(module, request.name);
	if (next === undefined || !isRelativeSpecifier(next.specifier)) {
		return undefined;
	}

	return resolveDeclaration(
		{
			name: next.name,
			modulePath: path.resolve(path.dirname(request.modulePath), next.specifier),
		},
		readSource,
	);
}
