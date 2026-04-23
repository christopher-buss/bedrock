import { isRecord } from "#src/internal/utils/is-record";
import { getOpenApiDocument } from "#tests/conformance/_helpers";

/**
 * The result of matching a concrete `(method, url)` pair against the
 * templated paths in the vendored OpenAPI document.
 */
export interface OperationMatch {
	/** The raw OpenAPI operation node at `paths[template][method]`. */
	readonly operation: Readonly<Record<string, unknown>>;
	/** Captured path parameters, keyed by their template name. */
	readonly pathParams: Readonly<Record<string, string>>;
	/** The templated path the URL matched, e.g. `/foo/{bar}`. */
	readonly pathTemplate: string;
}

/**
 * The HTTP methods an {@link OperationMatch} can carry. Mirrors the
 * OpenAPI 3 path-item method set; lowercased because spec keys are
 * lowercase.
 */
type OpenApiMethod = "delete" | "get" | "patch" | "post" | "put";

interface CompiledOperation {
	readonly method: OpenApiMethod;
	readonly operation: Readonly<Record<string, unknown>>;
	readonly paramNames: ReadonlyArray<string>;
	readonly pathTemplate: string;
	readonly regex: RegExp;
}

let cachedCompiledOperations: ReadonlyArray<CompiledOperation> | undefined;
const matchCache = new Map<string, OperationMatch | undefined>();

/**
 * Resolves a concrete `(method, url)` pair to the OpenAPI operation it
 * targets. The URL may be absolute (scheme + host) or relative, and may
 * carry a query string; both are stripped before matching. Returns
 * `undefined` when no path template matches.
 *
 * Path parameters are matched with `[^/:]+`, which forbids crossing
 * segment separators (`/`) and action-verb prefixes (`:foo`). The
 * Roblox API does not use `:` inside identifiers, so this keeps
 * `/foo/{id}` from shadowing `/foo/{id}:action`.
 *
 * @param method - The HTTP method, case-insensitive.
 * @param url - The request URL, absolute or relative.
 * @returns The operation match, or `undefined` if none.
 */
export function findOperation(method: string, url: string): OperationMatch | undefined {
	const methodLower = method.toLowerCase();
	const cacheKey = `${methodLower} ${url}`;
	if (matchCache.has(cacheKey)) {
		return matchCache.get(cacheKey);
	}

	const normalizedUrl = normalizeUrl(url);
	const result = firstMatch(methodLower, normalizedUrl);
	matchCache.set(cacheKey, result);
	return result;
}

function capturePathParameters(
	parameterNames: ReadonlyArray<string>,
	match: RegExpExecArray,
): Record<string, string> {
	const pathParameters: Record<string, string> = {};
	for (const [index, name] of parameterNames.entries()) {
		pathParameters[name] = match[index + 1] ?? "";
	}

	return pathParameters;
}

function compileTemplate(pathTemplate: string): {
	paramNames: Array<string>;
	regex: RegExp;
} {
	const parameterNames: Array<string> = [];
	const escaped = pathTemplate.replace(/[.+*?^$()|[\]\\]/g, "\\$&");
	const parts: Array<string> = [];
	let lastIndex = 0;
	for (const match of escaped.matchAll(/\{([^}]+)\}/g)) {
		const [full, name] = match;
		if (name === undefined) {
			continue;
		}

		parts.push(escaped.slice(lastIndex, match.index), "([^/:]+)");
		parameterNames.push(name);
		lastIndex = match.index + full.length;
	}

	parts.push(escaped.slice(lastIndex));
	return { paramNames: parameterNames, regex: new RegExp(`^${parts.join("")}$`) };
}

function isOpenApiMethod(value: string): value is OpenApiMethod {
	return (
		value === "delete" ||
		value === "get" ||
		value === "patch" ||
		value === "post" ||
		value === "put"
	);
}

function getCompiledOperations(): ReadonlyArray<CompiledOperation> {
	if (cachedCompiledOperations !== undefined) {
		return cachedCompiledOperations;
	}

	const { paths } = getOpenApiDocument();
	if (!isRecord(paths)) {
		cachedCompiledOperations = [];
		return cachedCompiledOperations;
	}

	const compiled: Array<CompiledOperation> = [];
	for (const [pathTemplate, pathItem] of Object.entries(paths)) {
		if (!isRecord(pathItem)) {
			continue;
		}

		const { paramNames, regex } = compileTemplate(pathTemplate);
		for (const [methodKey, operation] of Object.entries(pathItem)) {
			const method = methodKey.toLowerCase();
			if (!isOpenApiMethod(method) || !isRecord(operation)) {
				continue;
			}

			compiled.push({ method, operation, paramNames, pathTemplate, regex });
		}
	}

	cachedCompiledOperations = compiled;
	return compiled;
}

function firstMatch(methodLower: string, normalizedUrl: string): OperationMatch | undefined {
	for (const op of getCompiledOperations()) {
		if (op.method !== methodLower) {
			continue;
		}

		const match = op.regex.exec(normalizedUrl);
		if (match === null) {
			continue;
		}

		return {
			operation: op.operation,
			pathParams: capturePathParameters(op.paramNames, match),
			pathTemplate: op.pathTemplate,
		};
	}

	return undefined;
}

function normalizeUrl(url: string): string {
	const withoutHost = url.replace(/^https?:\/\/[^/]+/, "");
	const questionIndex = withoutHost.indexOf("?");
	return questionIndex === -1 ? withoutHost : withoutHost.slice(0, questionIndex);
}
