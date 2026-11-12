import type { Result } from "@bedrock-rbx/ocale";

import type { ImportItem } from "../core/import-plan.ts";
import type { ImportCancelled, ImportChoice } from "../shell/import-items.ts";
import type { ImportKeyChoice, ImportPromptPort } from "./import-prompt-port.ts";
import type { RenderPort } from "./render.ts";

/** What the picker screens need. */
export interface ChooseImportInputs {
	/** Output port for the message about an empty Environment. */
	readonly clack: RenderPort;
	/** The Environment whose live items are shown. */
	readonly environment: string;
	/** The prompt screens. */
	readonly port: ImportPromptPort;
}

const NOTHING: ImportChoice = { selections: [], untrack: [] };

/**
 * Run the picker screens: pick items in the tree, pick the Keys to edit,
 * edit each one, then confirm the summary. A picked untracked item is
 * imported; a cleared tracked item is untracked. When the pick changes
 * nothing, no later screen is shown.
 *
 * @param inputs - The prompt port, output port and Environment.
 * @param items - Every live item of the Environment.
 * @returns The choice, or the cancellation of any screen.
 */
export async function chooseImportAsync(
	inputs: ChooseImportInputs,
	items: ReadonlyArray<ImportItem>,
): Promise<Result<ImportChoice, ImportCancelled>> {
	if (items.length === 0) {
		inputs.clack.logMessage(
			`"${inputs.environment}" has no live game passes, developer products or badges to import.`,
		);
		return { data: NOTHING, success: true };
	}

	const picked = await inputs.port.promptItems(items);
	if (!picked.success) {
		return picked;
	}

	const untrack = items.filter(
		(item) => item.trackedBy !== undefined && !picked.data.includes(item),
	);
	const fresh = picked.data.filter(({ trackedBy }) => trackedBy === undefined);
	if (fresh.length === 0 && untrack.length === 0) {
		return { data: NOTHING, success: true };
	}

	return confirmChoiceAsync(inputs, { fresh, untrack });
}

async function editKeysAsync(
	port: ImportPromptPort,
	items: ReadonlyArray<ImportItem>,
): Promise<Result<ReadonlyArray<ImportKeyChoice>, ImportCancelled>> {
	if (items.length === 0) {
		return { data: [], success: true };
	}

	const toEdit = await port.promptKeysToEdit(items);
	if (!toEdit.success) {
		return toEdit;
	}

	const choices: Array<ImportKeyChoice> = [];
	for (const item of items) {
		if (!toEdit.data.includes(item)) {
			choices.push({ key: item.key, item });
			continue;
		}

		const key = await port.promptKey(item);
		if (!key.success) {
			return key;
		}

		choices.push({ key: key.data, item });
	}

	return { data: choices, success: true };
}

async function confirmChoiceAsync(
	inputs: ChooseImportInputs,
	{
		fresh,
		untrack,
	}: { readonly fresh: ReadonlyArray<ImportItem>; readonly untrack: ReadonlyArray<ImportItem> },
): Promise<Result<ImportChoice, ImportCancelled>> {
	const imports = await editKeysAsync(inputs.port, fresh);
	if (!imports.success) {
		return imports;
	}

	const confirmed = await inputs.port.confirmImport({
		environment: inputs.environment,
		imports: imports.data,
		untrack,
	});
	if (!confirmed.success) {
		return confirmed;
	}

	const selections = imports.data.map(({ key, item: { kind, robloxId } }) => {
		return { key, kind, robloxId };
	});
	return {
		data: { selections, untrack: untrack.map(({ kind, robloxId }) => ({ kind, robloxId })) },
		success: true,
	};
}
