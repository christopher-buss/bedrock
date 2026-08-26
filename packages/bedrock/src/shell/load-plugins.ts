import type { Result } from "@bedrock-rbx/ocale";

import type { ConfigError } from "../core/config-error.ts";
import { safeStringify } from "../core/error-chain.ts";
import { isRecord } from "../core/is-record.ts";
import type { ModuleImporter } from "../ports/module-importer.ts";

// The code Node and Bun both set on the error an unresolvable specifier
// rejects with. It is what separates "the package is not installed" from
// "the package is installed and blew up while evaluating".
const MODULE_NOT_FOUND_CODE = "ERR_MODULE_NOT_FOUND";

const NO_PLUGIN_EXPORT_MESSAGE = "expected a default-exported plugin object";

/**
 * Import every plugin named in the parsed config, in declaration order.
 *
 * Runs after the config is parsed but before it is validated, so a plugin is
 * loaded before the fields it exists to make valid are checked, and a broken
 * install is reported instead of the validation issues it causes.
 *
 * @param importModule - Injected module importer.
 * @param config - The parsed, not-yet-validated config object.
 * @returns `Ok` once every specifier has been imported, or `Err` with the
 * `pluginLoadFailed` error for the first specifier that could not be loaded.
 */
export async function loadPluginsAsync(
	importModule: ModuleImporter,
	config: Record<string, unknown>,
): Promise<Result<undefined, ConfigError>> {
	const specifiers = config["plugins"];
	if (!isSpecifierList(specifiers)) {
		return { data: undefined, success: true };
	}

	for (const specifier of specifiers) {
		const outcome = await importPluginAsync(importModule, specifier);
		if (!outcome.success) {
			return outcome;
		}
	}

	return { data: undefined, success: true };
}

/**
 * Read a module's default export without assuming the module is a plain
 * record: an ESM namespace object is not one, so `isRecord` cannot gate the
 * property access here the way it gates the export itself.
 *
 * @param module - The imported module namespace.
 * @returns The module's `default` export, or `undefined` when it has none.
 */
function defaultExportOf(module: unknown): unknown {
	return typeof module === "object" && module !== null
		? Reflect.get(module, "default")
		: undefined;
}

/**
 * Decide whether a rejected import means the package could not be resolved
 * at all, as opposed to resolving and then throwing.
 *
 * @param err - The value the import rejected with.
 * @returns `true` when the rejection carries the module-not-found code.
 */
function isModuleNotFound(err: unknown): boolean {
	return err instanceof Error && Reflect.get(err, "code") === MODULE_NOT_FOUND_CODE;
}

/**
 * Import one plugin, mapping an import rejection onto the
 * `pluginLoadFailed` error that names the specifier that produced it.
 *
 * @param importModule - Injected module importer.
 * @param specifier - The module specifier to import.
 * @returns `Ok` when the module imported, `Err` otherwise.
 */
async function importPluginAsync(
	importModule: ModuleImporter,
	specifier: string,
): Promise<Result<undefined, ConfigError>> {
	let module: unknown;
	try {
		module = await importModule(specifier);
	} catch (err) {
		return {
			err: {
				kind: "pluginLoadFailed",
				message: safeStringify(err),
				reason: isModuleNotFound(err) ? "notInstalled" : "importThrew",
				specifier,
			},
			success: false,
		};
	}

	if (!isRecord(defaultExportOf(module))) {
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
