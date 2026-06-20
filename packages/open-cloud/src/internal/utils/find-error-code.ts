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
	const code = Reflect.get(error, "code");
	return typeof code === "string" ? code : undefined;
}

/**
 * `DOMException.name` produced when an `AbortSignal.timeout` fires. This is the
 * web-standard discriminator (stable across Node and Bun, unlike the
 * runtime-specific message) and distinguishes the SDK's own request timeout
 * from a caller-supplied cancellation, which surfaces as `"AbortError"`.
 */
const TIMEOUT_ABORT_NAME = "TimeoutError";

/**
 * Reports whether an error chain was produced by the SDK's own
 * `AbortSignal.timeout` self-abort. Such a `DOMException` carries a numeric
 * `code` (23), so {@link findErrorCode} (which only reads string codes)
 * cannot classify it; this walk keys on `name` instead. A caller-supplied
 * abort (`"AbortError"`) is deliberately not matched.
 *
 * @example
 *
 * ```ts
 * import { isTimeoutAbort } from "./find-error-code";
 *
 * const error = new Error("Network request failed", {
 *     cause: new DOMException("timed out", "TimeoutError"),
 * });
 *
 * expect(isTimeoutAbort(error)).toBe(true);
 * expect(isTimeoutAbort(new DOMException("cancelled", "AbortError"))).toBe(false);
 * ```
 *
 * @param error - The error to inspect; typically a `NetworkError`.
 * @returns `true` when a `TimeoutError` abort sits within the cause chain.
 */
export function isTimeoutAbort(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < MAX_DEPTH && current instanceof Error; depth += 1) {
		if (Reflect.get(current, "name") === TIMEOUT_ABORT_NAME) {
			return true;
		}

		current = current.cause;
	}

	return false;
}
