import { isRecord } from "./is-record.ts";

/**
 * Narrows an untyped response body to the `JSONValue` accepted by
 * `ApiError.details`. `HttpResponse.body` is `unknown` because a transport may
 * hand back anything, but only a JSON graph is safe to retain on an error for
 * diagnostics. Anything else — functions, symbols, bigints, class instances,
 * or a cyclic graph — is dropped rather than asserted through.
 *
 * @param value - The parsed response body, or `undefined` for an empty body.
 * @returns The value as a `JSONValue`, or `undefined` when it is absent or not
 *   JSON-representable.
 */
export function toJsonDetails(value: unknown): JSONValue | undefined {
	return asJsonValue(value, new Set());
}

function asJsonValue(value: unknown, seen: Set<object>): JSONValue | undefined {
	if (value === null) {
		// eslint-disable-next-line unicorn/no-null -- JSON null is a JSONValue; the repo's undefined-only rule stops at this wire boundary
		return null;
	}

	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}

	if (Array.isArray(value)) {
		return asJsonArray(value, seen);
	}

	if (isRecord(value)) {
		return asJsonObject(value, seen);
	}

	return undefined;
}

function asJsonArray(value: ReadonlyArray<unknown>, seen: Set<object>): JSONValue | undefined {
	if (seen.has(value)) {
		return undefined;
	}

	seen.add(value);
	const items: Array<JSONValue> = [];
	for (const item of value) {
		const converted = asJsonValue(item, seen);
		if (converted === undefined) {
			return undefined;
		}

		items.push(converted);
	}

	seen.delete(value);
	return items;
}

function asJsonObject(value: Record<string, unknown>, seen: Set<object>): JSONValue | undefined {
	if (seen.has(value)) {
		return undefined;
	}

	seen.add(value);
	const entries: Array<[string, JSONValue]> = [];
	for (const [key, item] of Object.entries(value)) {
		const converted = asJsonValue(item, seen);
		if (converted === undefined) {
			return undefined;
		}

		entries.push([key, converted]);
	}

	seen.delete(value);
	return Object.fromEntries(entries);
}
