/**
 * Maximum cause-chain depth walked by {@link findErrorCode}. Caps pathological
 * self-referential or deeply nested chains; transport failures surface as
 * `NetworkError → TypeError("fetch failed") → OS Error{code}`, so three
 * levels is the expected shape and five leaves headroom.
 */
const MAX_DEPTH = 5;

/**
 * Walks an error's `cause` chain and returns the first node-style string
 * `code` it finds (for example `"ECONNRESET"`, `"ETIMEDOUT"`). Native `fetch`
 * surfaces a transport reset as a `NetworkError` wrapping a
 * `TypeError("fetch failed")` whose own cause carries the OS-level `code`, so
 * the code lives several links down the chain.
 *
 * @example
 *
 * ```ts
 * import { findErrorCode } from "./find-error-code";
 *
 * const root = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
 * const outer = new Error("Network request failed", {
 *     cause: new TypeError("fetch failed", { cause: root }),
 * });
 *
 * expect(findErrorCode(outer)).toBe("ECONNRESET");
 * ```
 *
 * @param error - The error to inspect; typically a `NetworkError`.
 * @returns The first string `code` in the chain, or `undefined` if none.
 */
export function findErrorCode(error: unknown): string | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < MAX_DEPTH && current instanceof Error; depth += 1) {
		const code = readCode(current);
		if (code !== undefined) {
			return code;
		}

		current = current.cause;
	}

	return undefined;
}

function readCode(error: Error): string | undefined {
	const code: unknown = Reflect.get(error, "code");
	return typeof code === "string" ? code : undefined;
}
