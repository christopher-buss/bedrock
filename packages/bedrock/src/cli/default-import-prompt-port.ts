import {
	type ConfirmOptions,
	confirm as defaultConfirm,
	groupMultiselect as defaultGroupMultiselect,
	isCancel as defaultIsCancel,
	multiselect as defaultMultiselect,
	note as defaultNote,
	text as defaultText,
	type GroupMultiSelectOptions,
	type MultiSelectOptions,
	type TextOptions,
} from "@clack/prompts";

import type { ImportKind } from "../core/import-current.ts";
import type { ImportItem } from "../core/import-plan.ts";
import { isResourceKey } from "../types/ids.ts";
import type { ImportPromptPort, ImportPromptResult, ImportSummary } from "./import-prompt-port.ts";

/**
 * Test seam for {@link createDefaultImportPromptPort}. Production callers
 * omit `helpers` and the port delegates to `@clack/prompts`. Slot signatures
 * pin clack's generic prompts to `string` values so a `vi.fn` can stand in.
 */
export interface ImportPromptClackHelpers {
	/** Yes/no prompt; defaults to `@clack/prompts`'s `confirm`. */
	readonly confirm: (options: ConfirmOptions) => Promise<boolean | symbol>;
	/**
	 * Grouped multiselect; defaults to `@clack/prompts`'s `groupMultiselect`.
	 */
	readonly groupMultiselect: (
		options: GroupMultiSelectOptions<string>,
	) => Promise<Array<string> | symbol>;
	/** Cancel predicate; defaults to `@clack/prompts`'s `isCancel`. */
	readonly isCancel: (value: unknown) => value is symbol;
	/** Multiselect; defaults to `@clack/prompts`'s `multiselect`. */
	readonly multiselect: (options: MultiSelectOptions<string>) => Promise<Array<string> | symbol>;
	/** Boxed message; defaults to `@clack/prompts`'s `note`. */
	readonly note: (message?: string, title?: string) => void;
	/** Text prompt; defaults to `@clack/prompts`'s `text`. */
	readonly text: (options: TextOptions) => Promise<string | symbol>;
}

const defaultHelpers: ImportPromptClackHelpers = {
	confirm: defaultConfirm,
	groupMultiselect: defaultGroupMultiselect,
	isCancel: defaultIsCancel,
	multiselect: defaultMultiselect,
	note: defaultNote,
	text: defaultText,
};

const GROUP_LABELS: Readonly<Record<ImportKind, string>> = {
	badge: "Badges",
	developerProduct: "Developer products",
	gamePass: "Game passes",
};

const CANCELLED = { err: { kind: "cancelled" }, success: false } as const;

const INVALID_KEY = "Use letters, digits, - and _ only.";

/**
 * Construct an `ImportPromptPort` whose methods delegate to
 * `@clack/prompts`. A clack cancel becomes `Err({ kind: "cancelled" })`.
 *
 * @param helpers - Test-only seam for the clack primitives. Production
 *   callers omit this argument.
 * @returns A live `ImportPromptPort`.
 */
export function createDefaultImportPromptPort(
	helpers: ImportPromptClackHelpers = defaultHelpers,
): ImportPromptPort {
	return {
		confirmImport: async (summary) => confirmImportAsync(helpers, summary),
		promptItems: async (items) => promptItemsAsync(helpers, items),
		promptKey: async (item) => promptKeyAsync(helpers, item),
		promptKeysToEdit: async (items) => promptKeysToEditAsync(helpers, items),
	};
}

function valueOf({ kind, robloxId }: ImportItem): string {
	return `${kind}:${robloxId}`;
}

function picked(
	items: ReadonlyArray<ImportItem>,
	values: ReadonlyArray<string>,
): ImportPromptResult<ReadonlyArray<ImportItem>> {
	const chosen = new Set(values);
	return { data: items.filter((item) => chosen.has(valueOf(item))), success: true };
}

async function promptItemsAsync(
	helpers: ImportPromptClackHelpers,
	items: ReadonlyArray<ImportItem>,
): Promise<ImportPromptResult<ReadonlyArray<ImportItem>>> {
	const options: Record<string, Array<{ hint: string; label: string; value: string }>> = {};
	for (const item of items) {
		const tracked = item.trackedBy === undefined ? "" : `, tracked by '${item.trackedBy}'`;
		const group = (options[GROUP_LABELS[item.kind]] ??= []);
		group.push({
			hint: `id ${item.robloxId}${tracked}`,
			label: item.name,
			value: valueOf(item),
		});
	}

	const result = await helpers.groupMultiselect({
		initialValues: items.filter(({ trackedBy }) => trackedBy !== undefined).map(valueOf),
		message:
			"Select the items to import. Tracked items start selected; clear one to stop tracking it.",
		options,
		required: false,
	});
	return helpers.isCancel(result) ? CANCELLED : picked(items, result);
}

async function promptKeysToEditAsync(
	helpers: ImportPromptClackHelpers,
	items: ReadonlyArray<ImportItem>,
): Promise<ImportPromptResult<ReadonlyArray<ImportItem>>> {
	const result = await helpers.multiselect({
		message: "Edit the Key of which items? Select none to keep the suggested Keys.",
		options: items.map((item) => {
			return { hint: item.name, label: item.key, value: valueOf(item) };
		}),
		required: false,
	});
	return helpers.isCancel(result) ? CANCELLED : picked(items, result);
}

async function promptKeyAsync(
	helpers: ImportPromptClackHelpers,
	item: ImportItem,
): Promise<ImportPromptResult<string>> {
	const result = await helpers.text({
		initialValue: item.key,
		message: `Key for "${item.name}"`,
		validate: (value) => {
			return value !== undefined && isResourceKey(value) ? undefined : INVALID_KEY;
		},
	});
	return helpers.isCancel(result) ? CANCELLED : { data: result, success: true };
}

function itemLine(sign: string, { key, item }: { item: ImportItem; key: string }): string {
	return `  ${sign} ${item.kind}:${key} (id ${item.robloxId}) "${item.name}"`;
}

function summaryText({ environment, imports, untrack }: ImportSummary): string {
	const lines: Array<string> = [];
	if (imports.length > 0) {
		lines.push(`Import from "${environment}":`, ...imports.map((one) => itemLine("+", one)));
	}

	if (untrack.length > 0) {
		lines.push(
			'Stop tracking (retired: "untrack"):',
			...untrack.map((item) => itemLine("-", { key: item.key, item })),
		);
	}

	return lines.join("\n");
}

async function confirmImportAsync(
	helpers: ImportPromptClackHelpers,
	summary: ImportSummary,
): Promise<ImportPromptResult<undefined>> {
	helpers.note(summaryText(summary), "Summary");
	const result = await helpers.confirm({ message: "Write these changes to the config?" });
	return result === true ? { data: undefined, success: true } : CANCELLED;
}
