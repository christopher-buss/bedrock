import type { MigratePromptPort } from "#src/cli/migrate-prompt-port";
import { vi } from "vitest";

/**
 * Build a `MigratePromptPort` whose five methods are independent
 * `vi.fn()` spies. Tests script answers per scenario via
 * `mockResolvedValueOnce({ data: ..., success: true })` (or the
 * `cancelled` Err shape). Used by `migrate.spec.ts` to drive the
 * full prompt sequence without touching real `@clack/prompts`.
 *
 * @returns A `MigratePromptPort` whose every method is a fresh
 *   `vi.fn()` instance.
 */
export function fakeMigratePromptPort(): MigratePromptPort {
	return {
		promptConfigFormat: vi.fn<MigratePromptPort["promptConfigFormat"]>(),
		promptGistId: vi.fn<MigratePromptPort["promptGistId"]>(),
		promptMigrationSource: vi.fn<MigratePromptPort["promptMigrationSource"]>(),
		promptPrimaryEnvironment: vi.fn<MigratePromptPort["promptPrimaryEnvironment"]>(),
		promptStateBackend: vi.fn<MigratePromptPort["promptStateBackend"]>(),
		promptStateFilePath: vi.fn<MigratePromptPort["promptStateFilePath"]>(),
	};
}
