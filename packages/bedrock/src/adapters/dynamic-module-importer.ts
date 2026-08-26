/**
 * Default module importer: resolves a plugin specifier against the project's
 * own module graph with a dynamic `import()`, so a plugin installed as an
 * ordinary dependency is found the way any other import of it would be.
 *
 * @param specifier - Module specifier taken verbatim from the config's
 * `plugins` list.
 * @returns The imported module namespace.
 */
export async function importPluginModuleAsync(specifier: string): Promise<unknown> {
	return import(specifier);
}
