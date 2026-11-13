import type { Result } from "@bedrock-rbx/ocale";

import type { ImportItem } from "../core/import-plan.ts";

/**
 * Result returned by every method on {@link ImportPromptPort}. The error
 * means the user cancelled (Ctrl-C, Esc) or declined to write.
 *
 * @template T - The data type returned on a successful prompt.
 */
export type ImportPromptResult<T> = Result<T, ImportPromptCancelled>;

/** A live item to import and the Key it is written under. */
export interface ImportKeyChoice {
	/** The Key to write. */
	readonly key: string;
	/** The live item. */
	readonly item: ImportItem;
}

/** What `bedrock import` writes once the user confirms. */
export interface ImportSummary {
	/** The Environment whose live items are imported. */
	readonly environment: string;
	/** Untracked items to import. */
	readonly imports: ReadonlyArray<ImportKeyChoice>;
	/** Tracked items to stop tracking with `retired: "untrack"`. */
	readonly untrack: ReadonlyArray<ImportItem>;
}

/**
 * Prompt port the interactive `bedrock import` renders through. The screens
 * run in order: pick items, pick the Keys to edit, edit each Key, confirm.
 */
export interface ImportPromptPort {
	/**
	 * Ask the user to confirm the summary. Declining is a cancellation.
	 */
	confirmImport(summary: ImportSummary): Promise<ImportPromptResult<undefined>>;
	/**
	 * Pick live items in a tree grouped by Kind. Tracked items start
	 * selected and untracked items start cleared.
	 */
	promptItems(
		items: ReadonlyArray<ImportItem>,
	): Promise<ImportPromptResult<ReadonlyArray<ImportItem>>>;
	/** Ask for the Key of one item, starting from the suggested Key. */
	promptKey(item: ImportItem): Promise<ImportPromptResult<string>>;
	/** Pick the items whose suggested Key to edit; none by default. */
	promptKeysToEdit(
		items: ReadonlyArray<ImportItem>,
	): Promise<ImportPromptResult<ReadonlyArray<ImportItem>>>;
}

/** The user cancelled a prompt or declined to write. */
interface ImportPromptCancelled {
	/** Literal discriminator for narrowing. */
	readonly kind: "cancelled";
}
