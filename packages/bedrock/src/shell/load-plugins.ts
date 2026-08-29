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
 * What one config's `plugins` field loaded to.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 */
export interface LoadedPlugins {
	/**
	 * How each loaded plugin is recorded, in the order the config listed
	 * them: the specifier it was named by, or the name a plugin listed by
	 * value declares. `undefined` when the field was not a list of entries
	 * to load and the authored value has to reach validation untouched.
	 */
	readonly names: ReadonlyArray<string> | undefined;
	/** What those plugins collectively declared. */
	readonly registry: PluginRegistry;
}

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
 * Inputs for loading one entry of the config's `plugins` list.
 */
interface LoadEntryInput {
	/** The entry as the config wrote it. */
	readonly entry: Record<string, unknown> | string;
	/** Injected module importer. */
	readonly importModule: ModuleImporter;
	/** Position of this entry in the list, which labels a nameless plugin. */
	readonly index: number;
	/**
	 * Directory holding the config file, which every specifier resolves
	 * from.
	 */
	readonly sourceDirectory: string;
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
 * @returns `Ok` with the registry the loaded plugins produced and the names
 * to record in place of what the config listed, `Err` with the
 * `pluginLoadFailed` error for the first entry that could not be loaded, or
 * `Err` with `stateBackendConflict` when two of them claim one backend name.
 */
export async function loadPluginsAsync({
	config,
	importModule,
	sourceDirectory,
}: LoadPluginsInput): Promise<Result<LoadedPlugins, ConfigError>> {
	const declared = config["plugins"];
	const entries = isEntryList(declared) ? declared : undefined;

	const loaded: Array<LoadedPlugin> = [];
	const indexed = (entries ?? []).entries();
	for (const [index, entry] of indexed) {
		const outcome = await loadEntryAsync({ entry, importModule, index, sourceDirectory });
		if (!outcome.success) {
			return outcome;
		}

		loaded.push(outcome.data);
	}

	const registry = buildPluginRegistry(loaded);
	if (!registry.success) {
		return registry;
	}

	return {
		data: {
			names: entries === undefined ? undefined : loaded.map(({ specifier }) => specifier),
			registry: registry.data,
		},
		success: true,
	};
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
 * Load one `plugins` entry, paired with the label every diagnostic about it
 * carries.
 *
 * A specifier labels itself: it is the text the user can go and edit. A
 * plugin the config carries has none, so it is labelled by the name it
 * declares, and by its position in the list until that name has been read.
 *
 * @param input - The entry, its position, and the seams an import needs.
 * @returns `Ok` with the loaded plugin and its label, or the
 * `pluginLoadFailed` error naming the entry.
 */
async function loadEntryAsync({
	entry,
	importModule,
	index,
	sourceDirectory,
}: LoadEntryInput): Promise<Result<LoadedPlugin, ConfigError>> {
	if (typeof entry === "string") {
		const imported = await importPluginAsync({
			importModule,
			sourceDirectory,
			specifier: entry,
		});
		return imported.success
			? { data: { plugin: imported.data, specifier: entry }, success: true }
			: imported;
	}

	const read = readPluginShape(entry, `plugins[${String(index)}]`);
	return read.success
		? { data: { plugin: read.data, specifier: read.data.name }, success: true }
		: read;
}

/**
 * Narrow the raw `plugins` value to the list of entries to load: a module
 * specifier to import, or a plugin the config carries itself.
 *
 * Anything else - absent, a bare string, a list holding neither - loads
 * nothing at all, so `validateConfig` reports the malformed value as an
 * ordinary field-level issue. Nothing in a malformed list runs, including
 * the entries that were well-formed.
 *
 * @param value - The raw `plugins` value read off the parsed config.
 * @returns `true` when every entry is a specifier or a record.
 */
function isEntryList(value: unknown): value is ReadonlyArray<Record<string, unknown> | string> {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string" || isRecord(entry))
	);
}
