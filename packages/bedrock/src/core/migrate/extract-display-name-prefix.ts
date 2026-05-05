/**
 * Result of inspecting a display name for a Mantle-style `[LABEL]` prefix.
 * `label` is `undefined` when the input does not match the bracketed-prefix
 * shape Mantle emits; in that case `body` echoes the input unchanged.
 */
export interface ExtractedDisplayName {
	/** Display name with the bracketed prefix and trailing whitespace stripped, or the input verbatim when no prefix matched. */
	readonly body: string;
	/** Captured label from the bracketed prefix, or `undefined` when the input did not match. */
	readonly label: string | undefined;
}

/**
 * Lift the leading bracketed prefix off a display name produced by Mantle's
 * environment-name stamping. A match requires `[LABEL] body` with a
 * non-empty label, mandatory whitespace after the closing bracket, and a
 * non-empty body. When the input does not match, `label` is `undefined` and
 * `body` is the input verbatim, so callers can round-trip arbitrary
 * display-name shapes without losing data.
 *
 * @param value - Raw display name to inspect.
 * @returns The captured label (or `undefined`) and the unprefixed body.
 */
export function extractDisplayNamePrefix(value: string): ExtractedDisplayName {
	const passthrough: ExtractedDisplayName = { body: value, label: undefined };
	if (!value.startsWith("[")) {
		return passthrough;
	}

	const closeIndex = value.indexOf("]");
	if (closeIndex < 2) {
		return passthrough;
	}

	const afterBracket = value.slice(closeIndex + 1);
	const body = afterBracket.trimStart();
	if (body === afterBracket) {
		return passthrough;
	}

	if (body === "") {
		return passthrough;
	}

	return { body, label: value.slice(1, closeIndex) };
}
