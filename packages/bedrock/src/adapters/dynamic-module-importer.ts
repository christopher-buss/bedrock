import type { Result } from "@bedrock-rbx/ocale";

import { resolveModuleURL } from "exsolve";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { safeStringify } from "../core/error-chain.ts";
import type { ModuleImporter, ModuleImportError } from "../ports/module-importer.ts";

// Probed for a specifier naming a file without one, mirroring the config
// formats bedrock already loads, so a plugin kept beside the config can be
// written the way that config imports anything else.
const PLUGIN_EXTENSIONS = [".mjs", ".js", ".mts", ".ts", ".cjs", ".cts"];

// Only path-shaped specifiers take a suffix; a bare specifier goes through
// its package's own `exports`.
const PLUGIN_SUFFIXES = ["", "/index"];

/**
 * Default {@link ModuleImporter}: resolves `specifier` as if it were
 * imported from a file in `fromDirectory`, then evaluates it.
 *
 * Resolving from the caller's directory rather than from this package is
 * what lets a project name a plugin it installed itself, or one living in a
 * sibling workspace folder. A plain `import()` here would resolve against
 * this package's own location inside `node_modules`, where neither is
 * reachable.
 *
 * @param specifier - Module specifier taken verbatim from the config's
 * `plugins` list: a package name or a path relative to `fromDirectory`.
 * @param fromDirectory - Directory to resolve the specifier from.
 * @returns `Ok` with the module namespace, or `Err` naming which of
 * resolution or evaluation failed.
 */
export async function importPluginModuleAsync(
	specifier: string,
	fromDirectory: string,
): Promise<Result<unknown, ModuleImportError>> {
	let resolved: string;
	try {
		resolved = resolveModuleURL(specifier, {
			extensions: PLUGIN_EXTENSIONS,
			from: pathToFileURL(join(fromDirectory, "/")),
			suffixes: PLUGIN_SUFFIXES,
		});
	} catch (err) {
		return { err: { kind: "resolutionFailed", message: safeStringify(err) }, success: false };
	}

	try {
		return { data: await import(resolved), success: true };
	} catch (err) {
		return { err: { kind: "evaluationFailed", message: safeStringify(err) }, success: false };
	}
}
