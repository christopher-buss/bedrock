import { vi } from "vitest";

import type { ImportPromptPort } from "#src/cli/import-prompt-port";

/**
 * Build an `ImportPromptPort` whose methods are independent `vi.fn()`
 * spies. Tests script answers with `mockResolvedValueOnce`.
 *
 * @returns An `ImportPromptPort` whose every method is a fresh `vi.fn()`.
 */
export function fakeImportPromptPort(): ImportPromptPort {
	return {
		confirmImport: vi.fn<ImportPromptPort["confirmImport"]>(),
		promptItems: vi.fn<ImportPromptPort["promptItems"]>(),
		promptKey: vi.fn<ImportPromptPort["promptKey"]>(),
		promptKeysToEdit: vi.fn<ImportPromptPort["promptKeysToEdit"]>(),
	};
}
