// Caps the walk to avoid looping on a self-referential cause chain.
const MAX_CAUSE_DEPTH = 5;

/**
 * Walks an error's `cause` chain for the first node-style string `code` (for
 * example `"ECONNRESET"`). A fetch transport reset surfaces as
 * `TypeError("fetch failed") → OS Error{code}`, so the code sits one or more
 * links down; naming it lets a diagnostic line distinguish a connection reset
 * from a DNS failure. Ocale computes this internally but does not export it,
 * so the bounded walk is reproduced here.
 *
 * @param error - The error whose cause chain is walked.
 * @returns The first string `code` found, or `undefined` when none exists
 *   within the bounded depth.
 */
export function findTransportCode(error: unknown): string | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
		const code = Reflect.get(current, "code");
		if (typeof code === "string") {
			return code;
		}

		current = current.cause;
	}

	return undefined;
}
