import { resolveModuleURL } from "exsolve";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Extensions probed for a specifier that names a file without one. Mirrors
// the config formats bedrock already loads, so a plugin sitting next to the
// config file can be written the same way the config imports anything else.
const PLUGIN_EXTENSIONS = [".mjs", ".js", ".mts", ".ts", ".cjs", ".cts"];

// A bare specifier resolves through the package's own `exports`; these
// suffixes only apply to path-shaped specifiers, letting `./tools/plugin`
// find `./tools/plugin/index.mjs`.
const PLUGIN_SUFFIXES = ["", "/index"];

/**
 * Default module importer: resolves `specifier` as if it were imported from
 * a file in `fromDirectory`, then evaluates it.
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
 * @returns The imported module namespace.
 */
export async function importPluginModuleAsync(
	specifier: string,
	fromDirectory: string,
): Promise<unknown> {
	const resolved = resolveModuleURL(specifier, {
		extensions: PLUGIN_EXTENSIONS,
		from: pathToFileURL(join(fromDirectory, "/")),
		suffixes: PLUGIN_SUFFIXES,
	});

	return import(resolved);
}
