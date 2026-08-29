import type { Result } from "@bedrock-rbx/ocale";

import type { ConfigError, PluginLoadFailureReason } from "../core/config-error.ts";
import { isRecord } from "../core/is-record.ts";
import {
	buildPluginRegistry,
	type LoadedPlugin,
	type PluginRegistry,
} from "../core/plugin-registry.ts";
import type { BedrockPlugin, StateBackendDeclaration } from "../core/plugin.ts";
import { isStateBackendSchema } from "../core/schema.ts";
import type { ModuleImporter, ModuleImportError } from "../ports/module-importer.ts";

// A plugin that is absent and one that is installed but broken are the same
// runtime error code; only the importer knows which step produced it.
const IMPORT_FAILURE_REASON = {
	evaluationFailed: "importThrew",
	resolutionFailed: "notInstalled",
} as const satisfies Record<ModuleImportError["kind"], PluginLoadFailureReason>;

const NO_PLUGIN_EXPORT_MESSAGE = "expected a default-exported plugin object";

const NO_PLUGIN_NAME_MESSAGE = "expected the plugin to name itself";

const BAD_STATE_BACKENDS_MESSAGE =
	"expected stateBackends to be a list of { name, schema, createPort } declarations, " +
	"where schema is an arktype object schema and createPort is a function";

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
 * Import every plugin named in the parsed config, in declaration order, and
 * collect what they declare into one registry.
 *
 * Runs after the config is parsed but before it is validated, so a plugin is
 * loaded before the fields it exists to make valid are checked, and a broken
 * install is reported instead of the validation issues it causes.
 *
 * @param input - Parsed config, injected importer, and the directory
 * specifiers resolve from.
 * @returns `Ok` with the registry the loaded plugins produced, `Err` with
 * the `pluginLoadFailed` error for the first specifier that could not be
 * loaded, or `Err` with `stateBackendConflict` when two of them claim one
 * backend name.
 */
export async function loadPluginsAsync({
	config,
	importModule,
	sourceDirectory,
}: LoadPluginsInput): Promise<Result<PluginRegistry, ConfigError>> {
	const declared = config["plugins"];
	const specifiers = isSpecifierList(declared) ? declared : [];

	const loaded: Array<LoadedPlugin> = [];
	for (const specifier of specifiers) {
		const outcome = await importPluginAsync({ importModule, sourceDirectory, specifier });
		if (!outcome.success) {
			return outcome;
		}

		loaded.push({ plugin: outcome.data, specifier });
	}

	return buildPluginRegistry(loaded);
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
 * Build the `pluginLoadFailed` error for a module that imported cleanly but
 * is not shaped like a plugin.
 *
 * @param specifier - Module specifier the config listed.
 * @param message - What core expected to find on the export.
 * @returns The `Err` result naming the specifier.
 */
function invalidExport(specifier: string, message: string): Result<never, ConfigError> {
	return {
		err: { kind: "pluginLoadFailed", message, reason: "invalidExport", specifier },
		success: false,
	};
}

/**
 * Narrow a plugin's raw `stateBackends` value to the declarations core can
 * register. Anything else is reported as an invalid export rather than
 * silently contributing nothing, because a plugin that declares a backend
 * core cannot read is a plugin whose config keys will not validate.
 *
 * A plugin is ordinary JavaScript at runtime, so the schema is checked for
 * what the `state` block does with it rather than trusted from its declared
 * type: an arktype `Type` is callable, and one over anything but an object
 * cannot be merged into the block.
 *
 * @param value - The raw `stateBackends` value read off the plugin export.
 * @returns `true` when every entry names a backend and carries both a
 * mergeable schema and a builder.
 */
function isDeclarationList(value: unknown): value is ReadonlyArray<StateBackendDeclaration> {
	return (
		Array.isArray(value) &&
		value.every((entry) => {
			return (
				isRecord(entry) &&
				typeof entry["name"] === "string" &&
				entry["name"].length > 0 &&
				typeof entry["schema"] === "function" &&
				isStateBackendSchema(entry["schema"]) &&
				typeof entry["createPort"] === "function"
			);
		})
	);
}

/**
 * Read a plugin off a record that is shaped like one, whether it arrived
 * from an imported module or straight out of a config authored in
 * TypeScript.
 *
 * A plugin is ordinary JavaScript at runtime, so its own declared type says
 * nothing here: both routes reach this check.
 *
 * @param exported - The record claiming to be a plugin.
 * @param specifier - How the failure names this plugin.
 * @returns `Ok` with the plugin core registers, or `Err` naming what the
 * export is missing.
 */
function readPluginShape(
	{ name, stateBackends }: Record<string, unknown>,
	specifier: string,
): Result<BedrockPlugin, ConfigError> {
	if (typeof name !== "string" || name.length === 0) {
		return invalidExport(specifier, NO_PLUGIN_NAME_MESSAGE);
	}

	if (stateBackends === undefined) {
		return { data: { name }, success: true };
	}

	if (!isDeclarationList(stateBackends)) {
		return invalidExport(specifier, BAD_STATE_BACKENDS_MESSAGE);
	}

	return { data: { name, stateBackends }, success: true };
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
}: ImportPluginInput): Promise<Result<BedrockPlugin, ConfigError>> {
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

	const exported = defaultExportOf(imported.data);
	if (!isRecord(exported)) {
		return invalidExport(specifier, NO_PLUGIN_EXPORT_MESSAGE);
	}

	return readPluginShape(exported, specifier);
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
