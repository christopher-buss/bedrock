import type { Result } from "@bedrock-rbx/ocale";

import { join } from "node:path";
import process from "node:process";

import type { PluginRegistry, RegisteredStateBackend } from "../../core/plugin-registry.ts";
import type {
	StateBackendBuildError,
	StateBackendFetch,
	StateBackendMigrateSource,
} from "../../core/plugin.ts";
import type { MigratePromptPort } from "../migrate-prompt-port.ts";
import { type MigrationSource, SUPPORTED_MIGRATION_SOURCES } from "../parse-migrate-options.ts";
import { describeUnknown } from "./describe-unknown.ts";
import { collectBackendAnswersAsync, fetchableBackends } from "./resolve-state-target.ts";
import type { ResolvedPortTarget } from "./write-migrated-states.ts";

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
	/**
	 * `state` block the fetching plugin translated its coordinates into,
	 * present only when that plugin declared a translation. It is what a
	 * user migrating back onto that same **Backend** gets instead of being
	 * asked for the same coordinates a second time.
	 */
	readonly translatedTarget?: ResolvedPortTarget | undefined;
}

/** What resolving the migration input needs from the migrate command. */
export interface MigrationInputDeps {
	/**
	 * Transport a fetching plugin routes its requests through, absent when
	 * the caller injected none and the plugin falls back to the runtime's.
	 */
	readonly fetch?: StateBackendFetch | undefined;
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
 * @param fetched - The answers naming what to fetch, and the transport to
 * hand the plugin.
 * @returns The bytes, or the refusal to report.
 */
async function readBytesAsync(
	source: StateBackendMigrateSource,
	fetched: {
		readonly coordinates: Readonly<Record<string, string>>;
		readonly fetch: StateBackendFetch | undefined;
	},
): Promise<Result<Uint8Array, StateBackendBuildError>> {
	try {
		return await source.readBytes({
			coordinates: fetched.coordinates,
			fetch: fetched.fetch,
			getEnv: (name) => process.env[name],
		});
	} catch (err) {
		return { err: { detail: err, reason: describeUnknown(err) }, success: false };
	}
}

/**
 * Build the target a plugin's translation names, mapping a throw onto
 * the same refusal its reader reports. A plugin is ordinary JavaScript,
 * so one that throws would otherwise escape the command and leave it
 * without an exit code.
 *
 * @param chosen - The **Backend** the coordinates were fetched from and
 * what it declared about fetching.
 * @param coordinates - The answers the state was fetched from.
 * @returns The target to record, `undefined` when the **Backend**
 * declared no translation, or the refusal to report.
 */
function translateTarget(
	{
		registered,
		source,
	}: { readonly registered: RegisteredStateBackend; readonly source: StateBackendMigrateSource },
	coordinates: Readonly<Record<string, string>>,
): Result<ResolvedPortTarget | undefined, StateBackendBuildError> {
	try {
		const translated = source.toStateConfig?.(coordinates);
		return {
			data:
				translated === undefined
					? undefined
					: {
							backend: "port",
							specifier: registered.specifier,
							stateConfig: { ...translated, backend: registered.declaration.name },
						},
			success: true,
		};
	} catch (err) {
		return { err: { detail: err, reason: describeUnknown(err) }, success: false };
	}
}

/**
 * Name the plugin a refusal came from, which is what lets a report say
 * whose payload it is carrying.
 *
 * @param err - What the plugin refused with.
 * @param registered - The **Backend** the refusal came from.
 * @returns The refusal, attributed.
 */
function attributedTo(
	err: StateBackendBuildError,
	registered: RegisteredStateBackend,
): MigrationSourceFailure {
	return { ...err, specifier: registered.specifier };
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

	const fetched = await readBytesAsync(source, {
		coordinates: coordinates.data,
		fetch: deps.fetch,
	});
	if (!fetched.success) {
		return { err: attributedTo(fetched.err, registered), success: false };
	}

	const translated = translateTarget({ registered, source }, coordinates.data);
	if (!translated.success) {
		return { err: attributedTo(translated.err, registered), success: false };
	}

	return {
		data: {
			stateFileBytes: fetched.data,
			stateFilePath: join(deps.projectRoot, FETCHED_STATE_BASENAME),
			translatedTarget: translated.data,
		},
		success: true,
	};
}
