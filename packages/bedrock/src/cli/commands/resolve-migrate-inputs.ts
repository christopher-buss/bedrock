import type { Result } from "@bedrock-rbx/ocale";

import { join } from "node:path";
import process from "node:process";

import type { PluginRegistry, RegisteredStateBackend } from "../../core/plugin-registry.ts";
import type { StateBackendBuildError, StateBackendMigrateSource } from "../../core/plugin.ts";
import type { MigratePromptPort } from "../migrate-prompt-port.ts";
import { type MigrationSource, SUPPORTED_MIGRATION_SOURCES } from "../parse-migrate-options.ts";
import { describeUnknown } from "./describe-unknown.ts";
import { collectBackendAnswersAsync, fetchableBackends } from "./resolve-state-target.ts";

/** Default name a plugin-fetched state file is reported and rooted at. */
const FETCHED_STATE_BASENAME = ".mantle-state.yml";

/**
 * Where `bedrock migrate` reads the previous tool's state from, and where
 * its outputs are rooted. `stateFileBytes` is present only when a plugin
 * fetched the bytes, in which case `stateFilePath` is a label rather than
 * a file that exists.
 */
export interface ResolvedMigrationInput {
	/** Bytes a plugin fetched, absent when the state is a local file. */
	readonly stateFileBytes?: Uint8Array;
	/** Path the migration is rooted at. */
	readonly stateFilePath: string;
}

/** What resolving the migration input needs from the migrate command. */
export interface MigrationInputDeps {
	/** What the loaded plugins declared. */
	readonly plugins: PluginRegistry;
	/** Directory a plugin-fetched migration roots its outputs at. */
	readonly projectRoot: string;
	/** Port every question is asked through. */
	readonly promptPort: MigratePromptPort;
}

/**
 * Failure surfaced when the plugin asked to fetch the previous tool's
 * state refused. Carries the plugin's own payload untouched, matching how
 * a **Backend** that cannot build is reported.
 */
export interface MigrationSourceFailure extends StateBackendBuildError {
	/** Module specifier of the plugin that refused. */
	readonly specifier: string;
}

/**
 * Resolve which source format to migrate from. A validated `--from`
 * value wins; when it is absent the user picks from
 * {@link SUPPORTED_MIGRATION_SOURCES} through the prompt port.
 * Cancelling the prompt surfaces as `Err("cancelled")`.
 *
 * @param from - The validated `--from` value, or `undefined` when the
 *   flag was omitted.
 * @param promptPort - The migrate prompt port whose
 *   `promptMigrationSource` is used as the interactive fallback.
 * @returns `Ok(source)` on success, or `Err("cancelled")` if the user
 *   aborted the prompt.
 */
export async function resolveMigrationSourceAsync(
	from: MigrationSource | undefined,
	promptPort: MigratePromptPort,
): Promise<Result<MigrationSource, "cancelled">> {
	if (from !== undefined) {
		return { data: from, success: true };
	}

	const promptResult = await promptPort.promptMigrationSource(SUPPORTED_MIGRATION_SOURCES);
	if (!promptResult.success) {
		return { err: "cancelled", success: false };
	}

	return { data: promptResult.data, success: true };
}

/**
 * Resolve where the previous tool's state is read from.
 *
 * A positional path wins. Otherwise the user is asked, but only when a
 * loaded plugin can fetch the state; with no such plugin the flow is the
 * local-file prompt it has always been.
 *
 * @param pathArgument - The positional `<stateFilePath>` value, or
 * `undefined` when omitted.
 * @param deps - Where to ask, what the plugins declared, and the
 * directory a fetched migration roots its outputs at.
 * @returns The resolved input, `Err("cancelled")` when the user aborted,
 * or the plugin's refusal to fetch.
 */
export async function resolveMigrationInputAsync(
	pathArgument: string | undefined,
	deps: MigrationInputDeps,
): Promise<Result<ResolvedMigrationInput, "cancelled" | MigrationSourceFailure>> {
	if (pathArgument !== undefined) {
		return { data: { stateFilePath: pathArgument }, success: true };
	}

	const fetchable = fetchableBackends(deps.plugins);
	if (fetchable.length === 0) {
		return resolveLocalInputAsync(deps.promptPort);
	}

	const chosen = await deps.promptPort.promptStateSource(fetchable);
	if (!chosen.success) {
		return { err: "cancelled", success: false };
	}

	const registered = deps.plugins.stateBackends.get(chosen.data);
	const source = registered?.declaration.migrateSource;
	// A picker whose answer names no fetching backend, "local" included,
	// read as choosing the local file it also offers.
	return registered === undefined || source === undefined
		? resolveLocalInputAsync(deps.promptPort)
		: fetchThroughPluginAsync({ registered, source }, deps);
}

/**
 * Ask for a local state-file path, the flow every project without a
 * fetching plugin follows.
 *
 * @param promptPort - The port the question is asked through.
 * @returns The resolved input, or the cancellation.
 */
async function resolveLocalInputAsync(
	promptPort: MigratePromptPort,
): Promise<Result<ResolvedMigrationInput, "cancelled">> {
	const path = await promptPort.promptStateFilePath();
	return path.success
		? { data: { stateFilePath: path.data }, success: true }
		: { err: "cancelled", success: false };
}

/**
 * Call a plugin's reader, mapping a rejection onto the same refusal a
 * well-behaved plugin returns. A plugin is ordinary JavaScript, so one
 * that throws instead of returning `Err` would otherwise escape the
 * command and leave it without an exit code.
 *
 * @param source - What the **Backend** declared about fetching.
 * @param coordinates - The answers naming what to fetch.
 * @returns The bytes, or the refusal to report.
 */
async function readBytesAsync(
	source: StateBackendMigrateSource,
	coordinates: Readonly<Record<string, string>>,
): Promise<Result<Uint8Array, StateBackendBuildError>> {
	try {
		return await source.readBytes({ coordinates, getEnv: (name) => process.env[name] });
	} catch (err) {
		return { err: { detail: err, reason: describeUnknown(err) }, success: false };
	}
}

/**
 * Ask a plugin's source fields and have it fetch the bytes they name.
 *
 * @param chosen - The **Backend** the user picked and what it declared
 * about fetching.
 * @param deps - Where to ask, what the plugins declared, and the output
 * root.
 * @returns The fetched bytes rooted at the project, the cancellation, or
 * the plugin's refusal.
 */
async function fetchThroughPluginAsync(
	{
		registered,
		source,
	}: { readonly registered: RegisteredStateBackend; readonly source: StateBackendMigrateSource },
	deps: MigrationInputDeps,
): Promise<Result<ResolvedMigrationInput, "cancelled" | MigrationSourceFailure>> {
	const coordinates = await collectBackendAnswersAsync(deps, source.prompts);
	if (!coordinates.success) {
		return { err: "cancelled", success: false };
	}

	const fetched = await readBytesAsync(source, coordinates.data);
	if (!fetched.success) {
		return {
			err: { ...fetched.err, specifier: registered.specifier },
			success: false,
		};
	}

	return {
		data: {
			stateFileBytes: fetched.data,
			stateFilePath: join(deps.projectRoot, FETCHED_STATE_BASENAME),
		},
		success: true,
	};
}
