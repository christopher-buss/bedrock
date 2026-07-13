// Mirrors the ocale transport's own 500-character cap on bodies it could not
// parse, so every diagnostic surface bounds payloads identically.
const MAX_DIAGNOSTIC_LENGTH = 500;

/**
 * Bounds a diagnostic string (a response body echoed into a failure line) to
 * 500 characters, appending an ellipsis when truncated, so a large JSON
 * payload or HTML gateway page never swamps a one-line diagnostic.
 *
 * @param text - The diagnostic text to bound.
 * @returns The text unchanged when within the cap, or truncated with a
 *   trailing ellipsis.
 */
export function boundDiagnostic(text: string): string {
	if (text.length > MAX_DIAGNOSTIC_LENGTH) {
		return `${text.slice(0, MAX_DIAGNOSTIC_LENGTH)}…`;
	}

	return text;
}
