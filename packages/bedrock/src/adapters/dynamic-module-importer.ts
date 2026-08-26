/**
 * Default module importer: hands the specifier to a dynamic `import()`, so a
 * plugin resolves the way any other import of it from this package would.
 *
 * @param specifier - Module specifier taken verbatim from the config's
 * `plugins` list.
 * @returns The imported module namespace.
 */
export async function importPluginModuleAsync(specifier: string): Promise<unknown> {
	return import(specifier);
}
