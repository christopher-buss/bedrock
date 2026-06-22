/**
 * A point-in-time rate-limit budget reading parsed from Roblox Open Cloud
 * response headers. Both fields are non-negative integers.
 */
export interface RateLimitSample {
	/** Requests still allowed in the current window (the most-constrained one). */
	readonly remaining: number;
	/** Seconds until the most-constrained window resets to full. */
	readonly resetSeconds: number;
}

/**
 * Reduces a comma-separated rate-limit header value (e.g. `"0, 70000"`) to a
 * single non-negative integer via `combine`. Tokens are trimmed; blank and
 * non-finite tokens (`""`, `"Infinity"`, `"abc"`) are dropped so a stray value
 * cannot corrupt the result. Returns `undefined` when the header is absent or
 * has no finite tokens.
 *
 * @param headerValue - The raw header value, or `undefined` if missing.
 * @param combine - Pairwise reducer, `Math.min` for remaining, `Math.max` for reset.
 * @returns The reduced, floored, clamped value, or `undefined`.
 */
export function reduceRateLimitTokens(
	headerValue: string | undefined,
	combine: (a: number, b: number) => number,
): number | undefined {
	if (headerValue === undefined) {
		return undefined;
	}

	const tokens = headerValue
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "")
		.map((part) => Number(part))
		.filter((value) => Number.isFinite(value));
	if (tokens.length === 0) {
		return undefined;
	}

	return Math.max(0, Math.floor(tokens.reduce(combine)));
}

/**
 * Parses the `x-ratelimit-remaining` and `x-ratelimit-reset` response headers
 * into a {@link RateLimitSample}. Each header may carry a comma-separated list
 * of per-window values; `remaining` takes the smallest (most constrained) and
 * `resetSeconds` takes the largest (longest wait), symmetric to how a 429's
 * retry delay is reduced. Returns `undefined` when either header is missing or
 * has no finite numeric tokens, so a caller can fall back to static pacing.
 *
 * @param headers - Response headers with lowercased keys.
 * @returns The parsed sample, or `undefined` when the budget cannot be read.
 */
export function parseRateLimitHeaders(
	headers: Readonly<Record<string, string>>,
): RateLimitSample | undefined {
	const remaining = reduceRateLimitTokens(headers["x-ratelimit-remaining"], (a, b) =>
		Math.min(a, b),
	);
	const resetSeconds = reduceRateLimitTokens(headers["x-ratelimit-reset"], (a, b) =>
		Math.max(a, b),
	);
	if (remaining === undefined || resetSeconds === undefined) {
		return undefined;
	}

	return { remaining, resetSeconds };
}
