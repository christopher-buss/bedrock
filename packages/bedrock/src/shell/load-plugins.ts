import type { ModuleImporter } from "../ports/module-importer.ts";

/**
 * Import every plugin named in the parsed config, in declaration order.
 *
 * Runs after the config is parsed but before it is validated, so a plugin is
 * loaded before the fields it exists to make valid are checked.
 *
 * @param importModule - Injected module importer.
 * @param config - The parsed, not-yet-validated config object.
 */
export async function loadPluginsAsync(
	importModule: ModuleImporter,
	config: Record<string, unknown>,
): Promise<void> {
	const specifiers = config["plugins"];
	if (!isSpecifierList(specifiers)) {
		return;
	}

	for (const specifier of specifiers) {
		await importModule(specifier);
	}
}

/**
 * Narrow the raw `plugins` value to the list of module specifiers to import.
 * Anything else - absent, a bare string, a list with a non-string entry -
 * yields no specifiers, so nothing is imported and `validateConfig` reports
 * the malformed value as an ordinary field-level issue.
 *
 * @param value - The raw `plugins` value read off the parsed config.
 * @returns `true` when `value` is a list whose every entry is a string.
 */
function isSpecifierList(value: unknown): value is ReadonlyArray<string> {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
