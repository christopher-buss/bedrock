import type { Result } from "@bedrock/ocale";

import { writeFile as nodeWriteFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";

import type { MigrateError, MigrationReport } from "../../core/migrate/migration-report.ts";
import { serializeConfig } from "../../core/migrate/serialize-config.ts";
import type { Config, GistStateConfig } from "../../core/schema.ts";
import { buildStatePort as defaultBuildStatePort } from "../../shell/build-state-port.ts";
import {
	migrateMantleState as defaultMigrateMantleState,
	type MigrateMantleStateDeps,
} from "../../shell/migrate-mantle-state.ts";
import { createDefaultMigratePromptPort } from "../default-migrate-prompt-port.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps } from "../index.ts";
import type { MigrateConfigFormat, MigratePromptPort } from "../migrate-prompt-port.ts";
import { type MigrationSource, parseMigrateOptions } from "../parse-migrate-options.ts";
import {
	type ClackPort,
	createClackPort,
	renderBuildStatePortError,
	renderMigrateError,
	renderMigrateParseError,
	renderMigrationSummary,
	renderStateWriteError,
} from "../render.ts";
import { resolveMigrationSource, resolveStateFilePath } from "./resolve-migrate-inputs.ts";

const FAILED_OUTRO = "migrate failed";

const CANCELLED_OUTRO = "migrate cancelled";

/**
 * Sentinel returned by inner orchestration helpers when they could not
 * produce a `MigrationReport`. `cancelled` means the user aborted a
 * prompt; `rendered` means the failure was already described to the
 * user via `renderMigrateError` and the caller should exit
 * unconditionally without re-rendering.
 */
type MigrateRunError = "cancelled" | "rendered";

interface ResolvedMigrate {
	readonly buildStatePort: typeof defaultBuildStatePort;
	readonly clack: ClackPort;
	readonly exit: (code: number) => void;
	readonly migrateMantleState: typeof defaultMigrateMantleState;
	readonly promptPort: MigratePromptPort;
	readonly writeFile: (path: string, contents: string) => Promise<void>;
}

interface RunMigrateInputs {
	readonly pathArg: string | undefined;
	readonly rawOptions: Readonly<Record<string, unknown>>;
	readonly resolved: ResolvedMigrate;
}

interface FinalizeInputs {
	readonly configFilePath: string;
	readonly configFormat: MigrateConfigFormat;
	readonly report: MigrationReport;
	readonly resolved: ResolvedMigrate;
	readonly stateConfig: GistStateConfig;
}

interface RunMigratorInputs {
	readonly configFormat: MigrateConfigFormat;
	readonly resolved: ResolvedMigrate;
	readonly stateFilePath: string;
}

interface MigratorIoError {
	readonly cause: unknown;
	readonly kind: "ioError";
	readonly path: string;
}

interface DispatchInputs {
	readonly resolved: ResolvedMigrate;
	readonly source: MigrationSource;
	readonly stateFilePath: string;
}

/**
 * Build the sade action for `bedrock migrate`. The returned function
 * consumes the optional positional path argument and the raw options
 * object sade hands the action callback. The command parses `--from`,
 * resolves the state file path (positional or interactive), prompts for
 * the output config format, runs the migrator, prompts for the state
 * backend coordinates, writes the per-environment states through the
 * configured `StatePort`, and emits an enriched bedrock config to disk.
 *
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function migrateCommand(
	deps: ProgDeps,
): (
	pathArgument: string | undefined,
	rawOptions: Readonly<Record<string, unknown>>,
) => Promise<void> {
	const resolved = resolveMigrate(deps);
	return async (pathArgument, rawOptions) => {
		const code = await runMigrate({ pathArg: pathArgument, rawOptions, resolved });
		resolved.exit(code);
	};
}

function resolveMigrate(deps: ProgDeps): ResolvedMigrate {
	return {
		buildStatePort: deps.buildStatePort ?? defaultBuildStatePort,
		clack: deps.clack ?? createClackPort(),
		exit: deps.exit ?? ((code) => process.exit(code)),
		migrateMantleState: deps.migrateMantleState ?? defaultMigrateMantleState,
		promptPort: deps.migratePromptPort ?? createDefaultMigratePromptPort(),
		writeFile:
			deps.writeFile ?? (async (path, contents) => nodeWriteFile(path, contents, "utf8")),
	};
}

function cancel(resolved: ResolvedMigrate): number {
	resolved.clack.cancel(CANCELLED_OUTRO);
	return EXIT_ERROR;
}

function failAfterRender(resolved: ResolvedMigrate): number {
	resolved.clack.cancel(FAILED_OUTRO);
	return EXIT_ERROR;
}

function renderedFailure(
	err: MigrateError,
	resolved: ResolvedMigrate,
): Result<MigrationReport, MigrateRunError> {
	renderMigrateError(err, resolved.clack);
	resolved.clack.cancel(FAILED_OUTRO);
	return { err: "rendered", success: false };
}

async function callMigrator(
	inputs: RunMigratorInputs & { readonly primaryEnvironment?: string },
): Promise<Result<MigrationReport, MigrateError | MigratorIoError>> {
	const callDeps: MigrateMantleStateDeps = {
		configFormat: inputs.configFormat,
		stateFilePath: inputs.stateFilePath,
		...(inputs.primaryEnvironment === undefined
			? {}
			: { primaryEnvironment: inputs.primaryEnvironment }),
	};
	try {
		return await inputs.resolved.migrateMantleState(callDeps);
	} catch (err) {
		return { err: { cause: err, kind: "ioError", path: inputs.stateFilePath }, success: false };
	}
}

function describeUnknown(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}

function renderIoFailure(
	err: MigratorIoError,
	resolved: ResolvedMigrate,
): Result<MigrationReport, MigrateRunError> {
	resolved.clack.logError(
		`failed to read Mantle state file '${err.path}': ${describeUnknown(err.cause)}`,
	);
	resolved.clack.cancel(FAILED_OUTRO);
	return { err: "rendered", success: false };
}

async function runMigratorWithPrompt(
	inputs: RunMigratorInputs,
): Promise<Result<MigrationReport, MigrateRunError>> {
	const first = await callMigrator(inputs);
	if (first.success) {
		return { data: first.data, success: true };
	}

	if (first.err.kind === "ioError") {
		return renderIoFailure(first.err, inputs.resolved);
	}

	if (first.err.kind !== "primaryEnvironmentRequired") {
		return renderedFailure(first.err, inputs.resolved);
	}

	const primary = await inputs.resolved.promptPort.promptPrimaryEnvironment(first.err.available);
	if (!primary.success) {
		return { err: "cancelled", success: false };
	}

	const second = await callMigrator({ ...inputs, primaryEnvironment: primary.data });
	if (second.success) {
		return { data: second.data, success: true };
	}

	if (second.err.kind === "ioError") {
		return renderIoFailure(second.err, inputs.resolved);
	}

	return renderedFailure(second.err, inputs.resolved);
}

async function promptForStateConfig(
	resolved: ResolvedMigrate,
): Promise<Result<GistStateConfig, "cancelled">> {
	const backend = await resolved.promptPort.promptStateBackend();
	if (!backend.success) {
		return { err: "cancelled", success: false };
	}

	const gistId = await resolved.promptPort.promptGistId();
	if (!gistId.success) {
		return { err: "cancelled", success: false };
	}

	return { data: { backend: backend.data, gistId: gistId.data }, success: true };
}

async function writeMigratedStates(inputs: FinalizeInputs): Promise<Result<void, void>> {
	const { report, resolved, stateConfig } = inputs;
	const portResult = resolved.buildStatePort({
		getEnv: (name) => process.env[name],
		stateConfig,
	});
	if (!portResult.success) {
		renderBuildStatePortError(portResult.err, resolved.clack);
		return { err: undefined, success: false };
	}

	for (const [environment, state] of Object.entries(report.statesByEnvironment)) {
		const writeResult = await portResult.data.write(state);
		if (!writeResult.success) {
			renderStateWriteError({ environment, err: writeResult.err }, resolved.clack);
			return { err: undefined, success: false };
		}

		resolved.clack.logSuccess(`${environment}: ${state.resources.length} resources migrated`);
	}

	return { data: undefined, success: true };
}

async function writeBedrockConfig(inputs: FinalizeInputs): Promise<Result<void, void>> {
	const { configFilePath, configFormat, report, resolved, stateConfig } = inputs;
	const enrichedConfig: Config = { ...report.config, state: stateConfig };
	const enrichedBytes = serializeConfig({ config: enrichedConfig, configFormat });
	try {
		await resolved.writeFile(configFilePath, enrichedBytes);
	} catch (err) {
		resolved.clack.logError(
			`config file write failed (${configFilePath}): ${describeUnknown(err)}`,
		);
		return { err: undefined, success: false };
	}

	resolved.clack.logSuccess(`wrote ${configFilePath}`);
	return { data: undefined, success: true };
}

async function finalize(inputs: FinalizeInputs): Promise<number> {
	const { report, resolved } = inputs;
	const stateWritten = await writeMigratedStates(inputs);
	if (!stateWritten.success) {
		return failAfterRender(resolved);
	}

	const written = await writeBedrockConfig(inputs);
	if (!written.success) {
		return failAfterRender(resolved);
	}

	renderMigrationSummary(report.summary, resolved.clack);
	resolved.clack.outro("migrate succeeded");
	return EXIT_OK;
}

function configFileFor(stateFilePath: string, format: MigrateConfigFormat): string {
	const extension = format === "typescript" ? "ts" : "yaml";
	return join(dirname(stateFilePath), `bedrock.config.${extension}`);
}

async function runWithStateFilePath(
	stateFilePath: string,
	resolved: ResolvedMigrate,
): Promise<number> {
	const formatResult = await resolved.promptPort.promptConfigFormat();
	if (!formatResult.success) {
		return cancel(resolved);
	}

	const reportResult = await runMigratorWithPrompt({
		configFormat: formatResult.data,
		resolved,
		stateFilePath,
	});
	if (!reportResult.success) {
		return reportResult.err === "cancelled" ? cancel(resolved) : EXIT_ERROR;
	}

	const stateConfigResult = await promptForStateConfig(resolved);
	if (!stateConfigResult.success) {
		return cancel(resolved);
	}

	return finalize({
		configFilePath: configFileFor(stateFilePath, formatResult.data),
		configFormat: formatResult.data,
		report: reportResult.data,
		resolved,
		stateConfig: stateConfigResult.data,
	});
}

async function dispatchBySource(inputs: DispatchInputs): Promise<number> {
	const { resolved, source, stateFilePath } = inputs;
	const dispatch: Record<MigrationSource, () => Promise<number>> = {
		mantle: async () => runWithStateFilePath(stateFilePath, resolved),
	};
	const handler = dispatch[source];
	return handler();
}

async function runMigrate(inputs: RunMigrateInputs): Promise<number> {
	const { pathArg, rawOptions, resolved } = inputs;
	resolved.clack.intro("bedrock migrate");

	const parsed = parseMigrateOptions(rawOptions);
	if (!parsed.success) {
		renderMigrateParseError(parsed.err, resolved.clack);
		return failAfterRender(resolved);
	}

	const source = await resolveMigrationSource(parsed.data.from, resolved.promptPort);
	if (!source.success) {
		return cancel(resolved);
	}

	const stateFilePath = await resolveStateFilePath(pathArg, resolved.promptPort);
	if (!stateFilePath.success) {
		return cancel(resolved);
	}

	return dispatchBySource({
		resolved,
		source: source.data,
		stateFilePath: stateFilePath.data,
	});
}
