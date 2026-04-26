import type { Result } from "@bedrock/ocale";

import type { MigrateError, MigrationReport } from "../core/migrate/migration-report.ts";

/**
 * Inputs for `migrateMantleState`. The state file is read via
 * `readFile` (defaults to `node:fs/promises.readFile`) so callers can
 * inject in-memory fixtures from tests and the JSDoc `@example` block
 * stays self-contained.
 *
 * `outputFormat` is locked to `"typescript"` in v0.1; the YAML output
 * lands in a follow-up issue that widens the literal.
 */
export interface MigrateMantleStateDeps {
	/**
	 * Output format for the emitted bedrock config file. V0.1 ships
	 * TypeScript (`bedrock.config.ts` with `defineConfig({...})`).
	 */
	readonly outputFormat: "typescript";
	/**
	 * Environment in the input state file whose resolved values seed
	 * the root config. Required when the state file declares more than
	 * one environment; ignored when only one environment is present.
	 */
	readonly primaryEnvironment?: string;
	/**
	 * Reads file bytes; defaults to `node:fs/promises.readFile`. Kept
	 * `Uint8Array`-typed to match `deploy`, `buildDesired`, and
	 * `buildDefaultRegistry`. UTF-8 decoding happens inside the migrator
	 * before YAML parsing.
	 */
	readonly readFile?: (path: string) => Promise<Uint8Array>;
	/** Absolute path to the `.mantle-state.yml` file to migrate. */
	readonly stateFilePath: string;
}

/**
 * Read a Mantle state file and produce a `MigrationReport` containing a
 * bedrock config, per-environment `BedrockState`s, and a structured list
 * of fields that did not migrate verbatim.
 *
 * Skeleton: returns an `internalError` placeholder until the parsing,
 * folding, and serialization slices replace the body. The signature and
 * `MigrationReport` shape are locked here so downstream slices fill in
 * behaviour without breaking the public contract.
 *
 * @param deps - Inputs for the migration.
 * @returns `Ok` with a `MigrationReport` on success, or `Err` with a
 *   discriminated `MigrateError` on failure.
 */
export async function migrateMantleState(
	deps: MigrateMantleStateDeps,
): Promise<Result<MigrationReport, MigrateError>> {
	return {
		err: {
			cause: { issues: [], kind: "validationFailed", sourceFile: deps.stateFilePath },
			kind: "internalError",
			reason: "migrateMantleState skeleton has no implementation yet",
		},
		success: false,
	};
}
