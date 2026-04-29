import type { Result } from "@bedrock/ocale";

/**
 * Output config format the user picks via `MigratePromptPort.promptConfigFormat`.
 * The migrator already supports both formats; this union just constrains
 * the choices the prompt offers.
 */
export type MigrateConfigFormat = "typescript" | "yaml";

/**
 * State backend kind the user picks via `MigratePromptPort.promptStateBackend`.
 * Single-option today; the union exists so adding a new backend kind widens
 * one tuple without reshaping the prompt port.
 */
export type MigrateStateBackend = "gist";

/**
 * Failure surfaced when the user aborts a `MigratePromptPort` prompt
 * (Ctrl-C, Esc). Plain data; narrow on `kind`.
 */
export interface MigratePromptCancelled {
	/** Literal discriminator for narrowing. */
	readonly kind: "cancelled";
}

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
