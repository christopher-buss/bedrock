import type { Result } from "@bedrock-rbx/ocale";

import type { MigratePromptPort } from "../migrate-prompt-port.ts";
import { type MigrationSource, SUPPORTED_MIGRATION_SOURCES } from "../parse-migrate-options.ts";

/**
 * Resolve the path to the input Mantle state file. The positional CLI
 * argument wins; when it is absent the user is asked through the prompt
 * port. Cancelling the prompt surfaces as `Err("cancelled")`.
 *
 * @param pathArgument - The positional `<stateFilePath>` value sade
 *   handed the action callback, or `undefined` when omitted.
 * @param promptPort - The migrate prompt port whose `promptStateFilePath`
 *   is used as the interactive fallback.
 * @returns `Ok(path)` on success, or `Err("cancelled")` if the user
 *   aborted the prompt.
 */
export async function resolveStateFilePath(
	pathArgument: string | undefined,
	promptPort: MigratePromptPort,
): Promise<Result<string, "cancelled">> {
	if (pathArgument !== undefined) {
		return { data: pathArgument, success: true };
	}

	const promptResult = await promptPort.promptStateFilePath();
	if (!promptResult.success) {
		return { err: "cancelled", success: false };
	}

	return { data: promptResult.data, success: true };
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
export async function resolveMigrationSource(
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
