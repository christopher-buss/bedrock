import type { Result } from "@bedrock-rbx/ocale";

import type { MigrationSource } from "./parse-migrate-options.ts";

/**
 * Output config format the user picks via `MigratePromptPort.promptConfigFormat`.
 * The migrator already supports both formats; this union just constrains
 * the choices the prompt offers.
 */
export type MigrateConfigFormat = "typescript" | "yaml";

/**
 * State backend kind the user picks via `MigratePromptPort.promptStateBackend`.
 * `gist` writes through the GitHub Gist `StatePort` adapter; `local` is a
 * migrate-only dump that writes each environment's state JSON to disk
 * beside the generated `bedrock.config` and leaves the config's `state:`
 * field unset for the user to fill in later.
 */
export type MigrateStateBackend = "gist" | "local";

/**
 * Result returned by every method on {@link MigratePromptPort}.
 *
 * @template T - The data type returned on a successful prompt.
 */
export type MigratePromptResult<T> = Result<T, MigratePromptCancelled>;

/**
 * Domain-specific prompt port the `bedrock migrate` command renders
 * through. Each method is purpose-built (no generic `select` or `text`),
 * which keeps tests free of the vitest/generics mocking quirk and lets
 * the command body read top-to-bottom without inline option arrays.
 *
 * Real production implementations call `@clack/prompts` underneath; tests
 * inject `fakeMigratePromptPort()` and script `mockResolvedValueOnce`
 * answers per scenario.
 */
export interface MigratePromptPort {
	/** Pick the output `bedrock.config.*` format. */
	promptConfigFormat(): Promise<MigratePromptResult<MigrateConfigFormat>>;
	/** Ask for the GitHub Gist ID that will hold the migrated state files. */
	promptGistId(): Promise<MigratePromptResult<string>>;
	/**
	 * Pick which source format to migrate from when `--from` was omitted.
	 * Caller passes the supported source list so adding a new source
	 * widens the picker without reshaping the port. The tuple type
	 * encodes that the list is non-empty, which the picker requires.
	 */
	promptMigrationSource(
		sources: readonly [MigrationSource, ...ReadonlyArray<MigrationSource>],
	): Promise<MigratePromptResult<MigrationSource>>;
	/**
	 * Pick the primary environment from a Mantle state file that declares
	 * more than one. Caller passes the available environment names.
	 */
	promptPrimaryEnvironment(
		environments: ReadonlyArray<string>,
	): Promise<MigratePromptResult<string>>;
	/** Pick the state backend kind. */
	promptStateBackend(): Promise<MigratePromptResult<MigrateStateBackend>>;
	/** Ask for the path to the input Mantle state file. */
	promptStateFilePath(): Promise<MigratePromptResult<string>>;
}

/**
 * Failure surfaced when the user aborts a `MigratePromptPort` prompt
 * (Ctrl-C, Esc). Plain data; narrow on `kind`.
 */
interface MigratePromptCancelled {
	/** Literal discriminator for narrowing. */
	readonly kind: "cancelled";
}
