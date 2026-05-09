import type { Result } from "@bedrock-rbx/ocale";

/**
 * Failure surfaced by a `LuauEvaluator` adapter. Plain-data discriminated
 * union; narrow on `kind` rather than using `instanceof`.
 *
 * - `missingRuntime` — the configured Luau runtime binary could not be
 *   resolved (ENOENT). The shell maps this to `luauRuntimeMissing` so the
 *   user gets the install hint.
 * - `evaluationFailed` — the runtime ran but reported an error: a non-zero
 *   exit, the bootstrap's ERR sentinel, malformed JSON, or a non-table root
 *   value. The shell maps this to `parseFailed`.
 */
export type LuauEvaluationError =
	| { readonly hint: string; readonly kind: "missingRuntime" }
	| { readonly kind: "evaluationFailed"; readonly message: string };

/**
 * Driven port for evaluating a Luau config file. The default adapter
 * (`createLuteLuauEvaluator`) shells out to the `lute` runtime; tests inject
 * fakes that synthesize success or failure without spawning a process.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 */
export type LuauEvaluator = (
	absPath: string,
) => Promise<Result<Record<string, unknown>, LuauEvaluationError>>;
