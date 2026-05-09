/**
 * Driven port for evaluating a Luau config file. The default adapter
 * (`createLuteLuauEvaluator`) shells out to the `lute` runtime; tests inject
 * fakes that synthesize success or failure without spawning a process.
 *
 * Errors travel as thrown exceptions so they can be caught and attributed by
 * the calling shell at the same seam c12 throws from. The lute adapter throws
 * `LuauRuntimeMissingError` for the missing-runtime case; every other failure
 * (parse error, timeout, non-zero exit) is a plain `Error`.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 */
export type LuauEvaluator = (absPath: string) => Promise<Record<string, unknown>>;
