// Caps the error-chain rendering to avoid looping on a self-referential chain.
const MAX_CAUSE_DEPTH = 5;

/**
 * Coerces an arbitrary thrown value to a one-line string without ever
 * throwing itself. Errors render as their message followed by the messages of
 * their `cause` chain (bounded), so a wrapped throw keeps its underlying
 * reason on the diagnostic line instead of collapsing to the outermost
 * message alone.
 *
 * @param value - The thrown value to describe.
 * @returns A single-line rendering of the value.
 */
export function safeStringify(value: unknown): string {
	if (value instanceof Error) {
		return describeErrorChain(value);
	}

	// `String(value)` can throw on null-prototype objects or values whose
	// `toString` / `Symbol.toPrimitive` rejects coercion; fall back so the
	// renderer never crashes mid-diagnostic.
	try {
		return String(value);
	} catch {
		return "<unprintable cause>";
	}
}

function describeErrorChain(error: Error): string {
	const parts = [error.message];
	let current: unknown = error.cause;
	while (current !== undefined && parts.length < MAX_CAUSE_DEPTH) {
		if (current instanceof Error) {
			parts.push(current.message);
			current = current.cause;
			continue;
		}

		// A non-Error cause (a thrown string, say) ends the chain, but its
		// value still carries diagnostic detail worth keeping on the line.
		parts.push(safeStringify(current));
		break;
	}

	return parts.join("; caused by: ");
}
