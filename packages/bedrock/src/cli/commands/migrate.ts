import type { Result } from "@bedrock-rbx/ocale";

import { mkdir as nodeMkdir, writeFile as nodeWriteFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";

import type { ConfigError } from "../../core/config-error.ts";
import type { MigrateError, MigrationReport } from "../../core/migrate/migration-report.ts";
import { EMPTY_PLUGIN_REGISTRY, type PluginRegistry } from "../../core/plugin-registry.ts";
import { buildStatePort as defaultBuildStatePort } from "../../shell/build-state-port.ts";
import { loadProjectAsync as defaultLoadProject } from "../../shell/load-config.ts";
import {
	migrateMantleState as defaultMigrateMantleState,
	type MigrateMantleStateDeps as MigrateMantleStateDependencies,
} from "../../shell/migrate-mantle-state.ts";
import { createClackPort } from "../clack-port.ts";
import { createDefaultMigratePromptPort } from "../default-migrate-prompt-port.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import type { MigrateConfigFormat, MigratePromptPort } from "../migrate-prompt-port.ts";
import { type MigrationSource, parseMigrateOptions } from "../parse-migrate-options.ts";
import {
	type ClackPort,
	renderDeployError,
	renderMigrateError,
	renderMigrateParseError,
	renderMigrationSourceError,
	renderMigrationSummary,
} from "../render.ts";
import { describeUnknown } from "./describe-unknown.ts";
import {
	type FinalizeDeps as FinalizeDependencies,
	type FinalizeInputs,
	persistMigrationAsync,
} from "./finalize-migration.ts";
import {
	type MigrationSourceFailure,
	type ResolvedMigrationInput,
	resolveMigrationInputAsync,
	resolveMigrationSourceAsync,
} from "./resolve-migrate-inputs.ts";
import { promptForStateTargetAsync } from "./resolve-state-target.ts";

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
	readonly mkdir: (path: string) => Promise<void>;
	readonly plugins: PluginRegistry;
	readonly projectRoot: string;
	readonly promptPort: MigratePromptPort;
	readonly writeFile: (path: string, contents: string) => Promise<void>;
}

interface RunMigrateInputs {
	readonly pathArg: string | undefined;
	readonly rawOptions: Readonly<Record<string, unknown>>;
	readonly resolved: ResolvedMigrate;
}

interface RunMigratorInputs extends ResolvedMigrationInput {
	readonly configFormat: MigrateConfigFormat;
	readonly resolved: ResolvedMigrate;
}

interface MigratorIoError {
	readonly cause: unknown;
	readonly kind: "ioError";
	readonly path: string;
}

interface DispatchInputs extends ResolvedMigrationInput {
	readonly resolved: ResolvedMigrate;
	readonly source: MigrationSource;
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
	deps: ProgDependencies,
): (
	pathArgument: string | undefined,
	rawOptions: Readonly<Record<string, unknown>>,
) => Promise<void> {
	return async (pathArgument, rawOptions) => {
		const projectRoot = deps.projectRoot ?? process.cwd();
		const discovered = await resolvePluginsAsync(deps, projectRoot);
		const resolved = resolveMigrate(deps, {
			plugins: discovered.success ? discovered.data : EMPTY_PLUGIN_REGISTRY,
			projectRoot,
		});
		if (!discovered.success) {
			renderDeployError({ cause: discovered.err, kind: "configLoadFailed" }, resolved.clack);
			resolved.exit(failAfterRender(resolved));
			return;
		}

		const code = await runMigrateAsync({ pathArg: pathArgument, rawOptions, resolved });
		resolved.exit(code);
	};
}

/**
 * What the project's own plugins declare, which is what decides the
 * **Backend**s migrate offers beyond the builtins.
 *
 * A project being migrated usually has no bedrock config yet, so an
 * absent config declares no plugins rather than failing: migrate's input
 * is the other tool's state, not this config. A config that exists but
 * cannot be loaded still fails, because a plugin the user installed to
 * migrate onto would otherwise vanish from the picker unexplained.
 *
 * @param dependencies - The CLI dependency slots.
 * @param projectRoot - Directory the config is searched from.
 * @returns The registry to offer targets from, or the load failure.
 */
async function resolvePluginsAsync(
	dependencies: ProgDependencies,
	projectRoot: string,
): Promise<Result<PluginRegistry, ConfigError>> {
	if (dependencies.plugins !== undefined) {
		return { data: dependencies.plugins, success: true };
	}

	const loaded = await (dependencies.loadProject ?? defaultLoadProject)({ cwd: projectRoot });
	if (loaded.success) {
		return { data: loaded.data.plugins, success: true };
	}

	// A project being migrated usually has no bedrock config yet, so an
	// absent one declares no plugins. Any other failure is a config the
	// user meant to have, and a plugin they meant to migrate onto.
	return loaded.err.kind === "fileNotFound"
		? { data: EMPTY_PLUGIN_REGISTRY, success: true }
		: loaded;
}

function resolveMigrate(
	dependencies: ProgDependencies,
	project: { readonly plugins: PluginRegistry; readonly projectRoot: string },
): ResolvedMigrate {
	return {
		buildStatePort: dependencies.buildStatePort ?? defaultBuildStatePort,
		clack: dependencies.clack ?? createClackPort(),
		exit: dependencies.exit ?? ((code) => process.exit(code)),
		migrateMantleState: dependencies.migrateMantleState ?? defaultMigrateMantleState,
		mkdir:
			dependencies.mkdir ??
			(async (path) => void (await nodeMkdir(path, { recursive: true }))),
		plugins: project.plugins,
		projectRoot: project.projectRoot,
		promptPort: dependencies.migratePromptPort ?? createDefaultMigratePromptPort(),
		writeFile:
			dependencies.writeFile ??
			(async (path, contents) => nodeWriteFile(path, contents, "utf8")),
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

async function callMigratorAsync(
	inputs: RunMigratorInputs & { readonly primaryEnvironment?: string },
): Promise<Result<MigrationReport, MigrateError | MigratorIoError>> {
	const { configFormat, primaryEnvironment, resolved, ...input } = inputs;
	// `input` carries `stateFileBytes` only when a plugin fetched it, so
	// spreading it is what keeps the key absent on the local-file path.
	const callDependencies: MigrateMantleStateDependencies = {
		configFormat,
		...input,
		...(primaryEnvironment === undefined ? {} : { primaryEnvironment }),
	};
	try {
		return await resolved.migrateMantleState(callDependencies);
	} catch (err) {
		return { err: { cause: err, kind: "ioError", path: inputs.stateFilePath }, success: false };
	}
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

async function runMigratorWithPromptAsync(
	inputs: RunMigratorInputs,
): Promise<Result<MigrationReport, MigrateRunError>> {
	const first = await callMigratorAsync(inputs);
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

	const second = await callMigratorAsync({ ...inputs, primaryEnvironment: primary.data });
	if (second.success) {
		return { data: second.data, success: true };
	}

	if (second.err.kind === "ioError") {
		return renderIoFailure(second.err, inputs.resolved);
	}

	return renderedFailure(second.err, inputs.resolved);
}

async function finalizeAsync(inputs: FinalizeInputs): Promise<number> {
	const persisted = await persistMigrationAsync(inputs);
	if (!persisted.success) {
		inputs.deps.clack.cancel(FAILED_OUTRO);
		return EXIT_ERROR;
	}

	renderMigrationSummary(
		{ reportPath: persisted.data, summary: inputs.report.summary },
		inputs.deps.clack,
	);
	inputs.deps.clack.outro("migrate succeeded");
	return EXIT_OK;
}

function configFileFor(stateFilePath: string, format: MigrateConfigFormat): string {
	const extension = format === "typescript" ? "ts" : "yaml";
	return join(dirname(stateFilePath), `bedrock.config.${extension}`);
}

function finalizeDependencies(resolved: ResolvedMigrate): FinalizeDependencies {
	return {
		buildStatePort: resolved.buildStatePort,
		clack: resolved.clack,
		mkdir: resolved.mkdir,
		plugins: resolved.plugins,
		writeFile: resolved.writeFile,
	};
}

async function runWithStateFilePathAsync({
	resolved,
	source: _ignoredSource,
	...input
}: DispatchInputs): Promise<number> {
	const formatResult = await resolved.promptPort.promptConfigFormat();
	if (!formatResult.success) {
		return cancel(resolved);
	}

	const reportResult = await runMigratorWithPromptAsync({
		configFormat: formatResult.data,
		resolved,
		...input,
	});
	if (!reportResult.success) {
		return reportResult.err === "cancelled" ? cancel(resolved) : EXIT_ERROR;
	}

	const targetResult = await promptForStateTargetAsync(resolved, input.stateFilePath);
	if (!targetResult.success) {
		return cancel(resolved);
	}

	return finalizeAsync({
		configFilePath: configFileFor(input.stateFilePath, formatResult.data),
		configFormat: formatResult.data,
		deps: finalizeDependencies(resolved),
		report: reportResult.data,
		stateFilePath: input.stateFilePath,
		target: targetResult.data,
	});
}

async function dispatchBySourceAsync(inputs: DispatchInputs): Promise<number> {
	const dispatch: Record<MigrationSource, () => Promise<number>> = {
		mantle: async () => runWithStateFilePathAsync(inputs),
	};
	const handler = dispatch[inputs.source];
	return handler();
}

/**
 * Report a plugin that could not fetch the previous tool's state, naming
 * the plugin and the step that gave up.
 *
 * @param err - The plugin's refusal.
 * @param resolved - The migrate command's resolved dependencies.
 * @returns The exit code for a failure already rendered.
 */
function reportSourceFailure(err: MigrationSourceFailure, resolved: ResolvedMigrate): number {
	renderMigrationSourceError(err, resolved.clack);
	return failAfterRender(resolved);
}

async function runMigrateAsync({
	pathArg,
	rawOptions,
	resolved,
}: RunMigrateInputs): Promise<number> {
	resolved.clack.intro("bedrock migrate");

	const parsed = parseMigrateOptions(rawOptions);
	if (!parsed.success) {
		renderMigrateParseError(parsed.err, resolved.clack);
		return failAfterRender(resolved);
	}

	const source = await resolveMigrationSourceAsync(parsed.data.from, resolved.promptPort);
	if (!source.success) {
		return cancel(resolved);
	}

	const input = await resolveMigrationInputAsync(pathArg, resolved);
	if (!input.success) {
		return input.err === "cancelled"
			? cancel(resolved)
			: reportSourceFailure(input.err, resolved);
	}

	return dispatchBySourceAsync({ resolved, source: source.data, ...input.data });
}
