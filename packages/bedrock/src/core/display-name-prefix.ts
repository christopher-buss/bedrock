/**
 * Default template applied when a project enables display-name prefixing
 * without supplying its own `displayNamePrefix.format`. Yields outputs
 * like `[STAGING] ` for an environment whose `label` is `"staging"`.
 */
export const DEFAULT_PREFIX_FORMAT = "[{LABEL}] ";

const PLACEHOLDER_PATTERN = /\{(LABEL|Label|label)\}/g;

/**
 * Render the prefix that selectEnvironment prepends to declared display
 * names when a project enables `displayNamePrefix`. The template
 * recognizes three placeholders:
 *
 * - `{label}`: label as written.
 * - `{LABEL}`: upper-cased label.
 * - `{Label}`: capitalized label (first character upper, rest as written).
 *
 * Other characters in the template flow through verbatim.
 *
 * @param label - Environment label declared on `EnvironmentEntry.label`.
 * @param format - Template string. Falls back to
 *   {@link DEFAULT_PREFIX_FORMAT} when omitted.
 * @returns The rendered prefix string.
 *
 * @example
 *
 * ```ts
 * import { renderDisplayNamePrefix } from "@bedrock-rbx/core";
 *
 * expect(renderDisplayNamePrefix("staging")).toBe("[STAGING] ");
 * expect(renderDisplayNamePrefix("staging", "{Label}: ")).toBe("Staging: ");
 * expect(renderDisplayNamePrefix("dev", "{LABEL}-{label}")).toBe("DEV-dev");
 * ```
 */
export function renderDisplayNamePrefix(label: string, format?: string): string {
	const template = format ?? DEFAULT_PREFIX_FORMAT;
	return template.replace(PLACEHOLDER_PATTERN, (_match, kind) => {
		if (kind === "LABEL") {
			return label.toUpperCase();
		}

		if (kind === "Label") {
			return capitalize(label);
		}

		return label;
	});
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
