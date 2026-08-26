import type { Result } from "@bedrock-rbx/ocale";

/**
 * Failure surfaced by a `ModuleImporter` adapter. Plain-data discriminated
 * union; narrow on `kind` rather than using `instanceof`.
 *
 * - `resolutionFailed` — the specifier did not name a module the adapter
 *   could find. The shell maps this to `notInstalled`.
 * - `evaluationFailed` — the module was found but threw while running,
 *   which includes a plugin whose own dependency is missing. The shell maps
 *   this to `importThrew`.
 */
export type ModuleImportError =
	| { readonly kind: "evaluationFailed"; readonly message: string }
	| { readonly kind: "resolutionFailed"; readonly message: string };

/**
 * Driven port for resolving and evaluating a plugin module named in config.
 * The default adapter (`importPluginModuleAsync`) resolves the specifier
 * from `fromDirectory` and then imports it; tests inject fakes so no
 * package has to exist on disk.
 *
 * Resolution and evaluation are separate steps so the two failures stay
 * distinguishable: both surface as the same runtime error code, and only
 * the adapter knows which of them produced it.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 */
export type ModuleImporter = (
	specifier: string,
	fromDirectory: string,
) => Promise<Result<unknown, ModuleImportError>>;
