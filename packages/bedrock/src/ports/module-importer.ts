/**
 * Driven port for resolving and evaluating a plugin module named in config.
 * The default adapter (`importPluginModuleAsync`) defers to a dynamic
 * `import()`;
 * tests inject fakes so no package has to exist on disk.
 *
 * Rejects the way `import()` does when the specifier cannot be resolved or
 * the module throws while evaluating; the loader attributes both to the
 * specifier that produced them.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 */
export type ModuleImporter = (specifier: string) => Promise<unknown>;
