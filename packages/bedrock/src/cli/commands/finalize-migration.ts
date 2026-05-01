import type { Result } from "@bedrock/ocale";

import type { MigrationReport } from "../../core/migrate/migration-report.ts";
import { serializeConfig } from "../../core/migrate/serialize-config.ts";
import type { Config } from "../../core/schema.ts";
import type { buildStatePort as defaultBuildStatePort } from "../../shell/build-state-port.ts";
import type { MigrateConfigFormat } from "../migrate-prompt-port.ts";
import type { ClackPort } from "../render.ts";
import { type ResolvedStateTarget, writeMigratedStates } from "./write-migrated-states.ts";
import { writeMigrationReport } from "./write-migration-report.ts";

/** Subset of the migrate command's resolved deps the finalize step touches. */
export interface FinalizeDeps {
	/** Default-constructs a `StatePort` once the gist target is resolved. */
	readonly buildStatePort: typeof defaultBuildStatePort;
	/** Output port for diagnostics and success lines. */
	readonly clack: ClackPort;
	/** Recursively creates a directory; used for the local-dump and report dirs. */
	readonly mkdir: (path: string) => Promise<void>;
	/** Writes a file's UTF-8 contents in one shot. */
	readonly writeFile: (path: string, contents: string) => Promise<void>;
}

/** Inputs for {@link persistMigration} and the inner config-write helper. */
export interface FinalizeInputs {
	/** Path to the bedrock config file to emit. */
	readonly configFilePath: string;
	/** Output format for the bedrock config (`typescript` or `yaml`). */
	readonly configFormat: MigrateConfigFormat;
	/** Resolved deps the writers dispatch through. */
	readonly deps: FinalizeDeps;
	/** Migration report whose state, config, and warnings are persisted. */
	readonly report: MigrationReport;
	/** Path to the Mantle state file the migration consumed. */
	readonly stateFilePath: string;
	/** Resolved state target picked by the user (gist or local). */
	readonly target: ResolvedStateTarget;
}

/**
 * Persist the migration's per-environment state, the bedrock config, and
 * the migration report (JSON + Markdown) in that order. Each failure
 * surface has already been rendered to clack by its respective writer; on
 * the first failure the function returns `Err` so the caller can exit
 * after a single shared `cancel("migrate failed")` line.
 *
 * @param inputs - Resolved deps, the migration report, and the resolved
 *   state-target plus paths the writers consume.
 * @returns `Ok` carrying the on-disk Markdown report path (used by the
 *   terminal summary line) once every writer succeeded; `Err(void)` once
 *   any writer reported failure.
 */
export async function persistMigration(inputs: FinalizeInputs): Promise<Result<string, void>> {
	const stateConfigWritten = await persistStateAndConfig(inputs);
	if (!stateConfigWritten.success) {
		return { err: undefined, success: false };
	}

	const reportPaths = await writeMigrationReport({
		deps: {
			clack: inputs.deps.clack,
			mkdir: inputs.deps.mkdir,
			writeFile: inputs.deps.writeFile,
		},
		report: inputs.report,
		stateFilePath: inputs.stateFilePath,
	});
	return reportPaths.success
		? { data: reportPaths.data.mdPath, success: true }
		: { err: undefined, success: false };
}

function describeUnknown(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}

async function writeBedrockConfig(inputs: FinalizeInputs): Promise<Result<void, void>> {
	const { configFilePath, configFormat, deps, report, target } = inputs;
	const { state: _ignoredState, ...configWithoutState } = report.config;
	const enrichedConfig: Config =
		target.backend === "gist"
			? { ...configWithoutState, state: target.stateConfig }
			: configWithoutState;
	const bytes = serializeConfig({ config: enrichedConfig, configFormat });
	try {
		await deps.writeFile(configFilePath, bytes);
	} catch (err) {
		deps.clack.logError(
			`config file write failed (${configFilePath}): ${describeUnknown(err)}`,
		);
		return { err: undefined, success: false };
	}

	deps.clack.logSuccess(`wrote ${configFilePath}`);
	return { data: undefined, success: true };
}

async function persistStateAndConfig(inputs: FinalizeInputs): Promise<Result<void, void>> {
	const stateWritten = await writeMigratedStates({
		deps: inputs.deps,
		report: inputs.report,
		target: inputs.target,
	});
	if (!stateWritten.success) {
		return { err: undefined, success: false };
	}

	const written = await writeBedrockConfig(inputs);
	return written.success
		? { data: undefined, success: true }
		: { err: undefined, success: false };
}
