import type { Result } from "@bedrock-rbx/ocale";

import type { ConfigError, PluginLoadFailureReason } from "../core/config-error.ts";
import { isRecord } from "../core/is-record.ts";
import type { ModuleImporter, ModuleImportError } from "../ports/module-importer.ts";

// A plugin that is absent and one that is installed but broken are the same
// runtime error code; only the importer knows which step produced it.
const IMPORT_FAILURE_REASON = {
	evaluationFailed: "importThrew",
	resolutionFailed: "notInstalled",
} as const satisfies Record<ModuleImportError["kind"], PluginLoadFailureReason>;

const NO_PLUGIN_EXPORT_MESSAGE = "expected a default-exported plugin object";

/**
 * Inputs for importing a single plugin.
 */
interface ImportPluginInput {
	/** Injected module importer. */
	readonly importModule: ModuleImporter;
	/**
	 * Directory holding the config file, which every specifier resolves
	 * from, so a relative path means what it would mean written inside that
	 * file.
	 */
	readonly sourceDirectory: string;
	/** The module specifier to import. */
	readonly specifier: string;
}

/**
 * Inputs for {@link loadPluginsAsync}.
 */
interface LoadPluginsInput {
	/** The parsed, not-yet-validated config object. */
	readonly config: Record<string, unknown>;
	/** Injected module importer. */
	readonly importModule: ModuleImporter;
	/**
	 * Directory holding the config file, which every specifier resolves
	 * from, so a relative path means what it would mean written inside that
	 * file.
	 */
	readonly sourceDirectory: string;
}

/**
 * Import every plugin named in the parsed config, in declaration order.
 *
 * Runs after the config is parsed but before it is validated, so a plugin is
 * loaded before the fields it exists to make valid are checked, and a broken
 * install is reported instead of the validation issues it causes.
 *
 * @param input - Parsed config, injected importer, and the directory
 * specifiers resolve from.
 * @returns `Ok` once every specifier has been imported, or `Err` with the
 * `pluginLoadFailed` error for the first specifier that could not be loaded.
 */
export async function loadPluginsAsync({
	config,
	importModule,
	sourceDirectory,
}: LoadPluginsInput): Promise<Result<undefined, ConfigError>> {
	const specifiers = config["plugins"];
	if (!isSpecifierList(specifiers)) {
		return { data: undefined, success: true };
	}

	for (const specifier of specifiers) {
		const outcome = await importPluginAsync({ importModule, sourceDirectory, specifier });
		if (!outcome.success) {
			return outcome;
		}
	}

	return { data: undefined, success: true };
}

/**
 * Read a module's default export without assuming the module is a plain
 * record: an ESM namespace object is not one, so `isRecord` cannot gate the
 * property access here the way it gates the export itself. `Object()` boxes
 * whatever the importer handed back, so no shape reaches `Reflect.get`
 * that it would throw on.
 *
 * @param module - The imported module namespace.
 * @returns The module's `default` export, or `undefined` when it has none.
 */
function defaultExportOf(module: unknown): unknown {
	return Reflect.get(Object(module), "default");
}

/**
 * Import one plugin, mapping an import rejection onto the
 * `pluginLoadFailed` error that names the specifier that produced it.
 *
 * @param input - The specifier to import, the injected importer, and the
 * directory to resolve from.
 * @returns `Ok` when the module imported, `Err` otherwise.
 */
async function importPluginAsync({
	importModule,
	sourceDirectory,
	specifier,
}: ImportPluginInput): Promise<Result<undefined, ConfigError>> {
	const imported = await importModule(specifier, sourceDirectory);
	if (!imported.success) {
		return {
			err: {
				kind: "pluginLoadFailed",
				message: imported.err.message,
				reason: IMPORT_FAILURE_REASON[imported.err.kind],
				specifier,
			},
			success: false,
		};
	}

	if (!isRecord(defaultExportOf(imported.data))) {
		return {
			err: {
				kind: "pluginLoadFailed",
				message: NO_PLUGIN_EXPORT_MESSAGE,
				reason: "invalidExport",
				specifier,
			},
			success: false,
		};
	}

	return { data: undefined, success: true };
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
