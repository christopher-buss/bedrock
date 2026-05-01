import type { Result } from "@bedrock/ocale";

import { join } from "node:path";
import process from "node:process";

import type { MigrationReport } from "../../core/migrate/migration-report.ts";
import type { GistStateConfig } from "../../core/schema.ts";
import { serializeStateFile } from "../../core/state-file.ts";
import type { buildStatePort as defaultBuildStatePort } from "../../shell/build-state-port.ts";
import type { ClackPort } from "../render.ts";
import { renderBuildStatePortError, renderStateWriteError } from "../render.ts";

/**
 * Where the migrate command persists per-environment states. The `gist`
 * arm carries the resolved {@link GistStateConfig} that gets written to
 * the bedrock config; the `local` arm carries the on-disk directory used
 * for the JSON-per-environment dump.
 */
export type ResolvedStateTarget =
	| { readonly backend: "gist"; readonly stateConfig: GistStateConfig }
	| { readonly backend: "local"; readonly outputDir: string };

/** Subset of the migrate command's resolved deps the writers need. */
interface WriterDeps {
	readonly buildStatePort: typeof defaultBuildStatePort;
	readonly clack: ClackPort;
	readonly mkdir: (path: string) => Promise<void>;
	readonly writeFile: (path: string, contents: string) => Promise<void>;
}

interface WriteInputs {
	readonly deps: WriterDeps;
	readonly report: MigrationReport;
	readonly target: ResolvedStateTarget;
}

/**
 * Persist every per-environment state in the migration report to the
 * resolved target. Dispatches to the GitHub Gist `StatePort` adapter or
 * to a local-file dump under `target.outputDir`. On failure the writer
 * has already rendered the error to `deps.clack`; the caller only needs
 * to translate the Err into an exit code.
 *
 * @param inputs - Resolved deps, the migration report, and the target
 *   the writer should dispatch on.
 * @returns `Ok(void)` once every environment has been written; `Err(void)`
 *   on the first failure (already rendered to clack).
 */
export async function writeMigratedStates(inputs: WriteInputs): Promise<Result<void, void>> {
	if (inputs.target.backend === "local") {
		return writeStatesToLocal({ ...inputs, target: inputs.target });
	}

	return writeStatesToGist({ ...inputs, target: inputs.target });
}

async function writeStatesToGist(
	inputs: WriteInputs & { readonly target: { readonly stateConfig: GistStateConfig } },
): Promise<Result<void, void>> {
	const { deps, report, target } = inputs;
	const portResult = deps.buildStatePort({
		getEnv: (name) => process.env[name],
		stateConfig: target.stateConfig,
	});
	if (!portResult.success) {
		renderBuildStatePortError(portResult.err, deps.clack);
		return { err: undefined, success: false };
	}

	for (const [environment, state] of Object.entries(report.statesByEnvironment)) {
		const writeResult = await portResult.data.write(state);
		if (!writeResult.success) {
			renderStateWriteError({ environment, err: writeResult.err }, deps.clack);
			return { err: undefined, success: false };
		}

		deps.clack.logSuccess(`${environment}: ${state.resources.length} resources migrated`);
	}

	return { data: undefined, success: true };
}

function describeUnknown(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}

async function writeStatesToLocal(
	inputs: WriteInputs & { readonly target: { readonly outputDir: string } },
): Promise<Result<void, void>> {
	const { deps, report, target } = inputs;
	try {
		await deps.mkdir(target.outputDir);
	} catch (err) {
		deps.clack.logError(
			`local state directory create failed (${target.outputDir}): ${describeUnknown(err)}`,
		);
		return { err: undefined, success: false };
	}

	for (const [environment, state] of Object.entries(report.statesByEnvironment)) {
		const filePath = join(target.outputDir, `${environment}.json`);
		try {
			await deps.writeFile(filePath, serializeStateFile(state));
		} catch (err) {
			deps.clack.logError(`local state write failed (${filePath}): ${describeUnknown(err)}`);
			return { err: undefined, success: false };
		}

		deps.clack.logSuccess(`${environment}: ${state.resources.length} resources migrated`);
	}

	return { data: undefined, success: true };
}
