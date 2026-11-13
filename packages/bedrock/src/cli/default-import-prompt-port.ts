import {
	type ConfirmOptions,
	confirm as defaultConfirm,
	groupMultiselect as defaultGroupMultiselect,
	isCancel as defaultIsCancel,
	multiselect as defaultMultiselect,
	note as defaultNote,
	select as defaultSelect,
	text as defaultText,
	type GroupMultiSelectOptions,
	type MultiSelectOptions,
	type SelectOptions,
	type TextOptions,
} from "@clack/prompts";

import type { ImportKind } from "../core/import-current.ts";
import type { ImportFieldDifference, ImportLinkCandidate } from "../core/import-links.ts";
import type { ImportItem } from "../core/import-plan-types.ts";
import { isResourceKey, type RobloxAssetId } from "../types/ids.ts";
import type {
	ImportLinkChoice,
	ImportLinkScreen,
	ImportPromptPort,
	ImportPromptResult,
	ImportSummary,
} from "./import-prompt-port.ts";

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
	/** Single select; defaults to `@clack/prompts`'s `select`. */
	readonly select: (options: SelectOptions<string>) => Promise<string | symbol>;
	/** Text prompt; defaults to `@clack/prompts`'s `text`. */
	readonly text: (options: TextOptions) => Promise<string | symbol>;
}

const defaultHelpers: ImportPromptClackHelpers = {
	confirm: defaultConfirm,
	groupMultiselect: defaultGroupMultiselect,
	isCancel: defaultIsCancel,
	multiselect: defaultMultiselect,
	note: defaultNote,
	select: defaultSelect,
	text: defaultText,
};

const GROUP_LABELS: Readonly<Record<ImportKind, string>> = {
	badge: "Badges",
	developerProduct: "Developer products",
	gamePass: "Game passes",
};

const CANCELLED = { err: { kind: "cancelled" }, success: false } as const;

const INVALID_KEY = "Use letters, digits, - and _ only.";

const ONLY_HERE =
	", not importable yet: no other Environment has an item to link it to, so a deploy would create it there";

const UNLINKED = "";

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
		promptLink: async (choice) => promptLinkAsync(helpers, choice),
		promptLinksToEdit: async (screen) => promptLinksToEditAsync(helpers, screen),
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
	const options: Record<
		string,
		Array<{ disabled: boolean; hint: string; label: string; value: string }>
	> = {};
	for (const item of items) {
		const tracked = item.trackedBy === undefined ? "" : `, tracked by '${item.trackedBy}'`;
		const only = item.unavailable === undefined ? "" : ONLY_HERE;
		const group = (options[GROUP_LABELS[item.kind]] ??= []);
		group.push({
			disabled: item.unavailable !== undefined,
			hint: `id ${item.robloxId}${tracked}${only}`,
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

function linkValue(choice: ImportLinkChoice): string {
	return valueOf(choice.item);
}

function differenceHint(differences: ReadonlyArray<ImportFieldDifference>): string {
	return differences.length === 0
		? ""
		: `, differs in ${differences.map(({ field }) => field).join(", ")}`;
}

function candidateOf(
	{ link }: ImportLinkChoice,
	robloxId: string | undefined,
): ImportLinkCandidate | undefined {
	return link.candidates.find((candidate) => candidate.robloxId === robloxId);
}

function suggestionHint(choice: ImportLinkChoice): string {
	const suggested = candidateOf(choice, choice.link.suggested);
	return suggested === undefined
		? "no same-name item: unlinked, the next deploy creates it"
		: `-> "${suggested.name}" (id ${suggested.robloxId})${differenceHint(suggested.differences)}`;
}

async function promptLinksToEditAsync(
	helpers: ImportPromptClackHelpers,
	{ environment, links }: ImportLinkScreen,
): Promise<ImportPromptResult<ReadonlyArray<ImportLinkChoice>>> {
	const result = await helpers.multiselect({
		message: `Links in "${environment}". Link which Keys by hand? The others take the suggested item.`,
		options: links.map((choice) => {
			return {
				hint: suggestionHint(choice),
				label: `${choice.link.kind}:${choice.link.key}`,
				value: linkValue(choice),
			};
		}),
		required: false,
	});
	if (helpers.isCancel(result)) {
		return CANCELLED;
	}

	const chosen = new Set(result);
	return { data: links.filter((choice) => chosen.has(linkValue(choice))), success: true };
}

function candidateOption(
	{ name, differences, robloxId }: ImportLinkCandidate,
	suggested: RobloxAssetId | undefined,
): { hint: string; label: string; value: string } {
	const tag = robloxId === suggested ? ", suggested" : "";
	return {
		hint: `id ${robloxId}${tag}${differenceHint(differences)}`,
		label: name,
		value: robloxId,
	};
}

async function promptLinkAsync(
	helpers: ImportPromptClackHelpers,
	choice: ImportLinkChoice,
): Promise<ImportPromptResult<RobloxAssetId | undefined>> {
	const { key, candidates, environment, kind, suggested } = choice.link;
	const result = await helpers.select({
		initialValue: suggested ?? UNLINKED,
		message: `Link ${kind}:${key} in "${environment}" to`,
		options: [
			...candidates.map((candidate) => candidateOption(candidate, suggested)),
			{ hint: "the next deploy creates it", label: "Leave unlinked", value: UNLINKED },
		],
	});
	if (helpers.isCancel(result)) {
		return CANCELLED;
	}

	return { data: candidateOf(choice, result)?.robloxId, success: true };
}

function shown(value: unknown): string {
	return typeof value === "string" ? `"${value}"` : String(value);
}

function linkLines(choice: ImportLinkChoice): ReadonlyArray<string> {
	const { key, kind, linked } = choice.link;
	const candidate = candidateOf(choice, linked);
	if (candidate === undefined) {
		return [`  + ${kind}:${key} not linked: the next deploy creates it`];
	}

	return [
		`  = ${kind}:${key} -> id ${candidate.robloxId} "${candidate.name}"`,
		...candidate.differences.map(({ config, field, live }) => {
			return `      ${field}: ${shown(live)} live, ${shown(config)} in config`;
		}),
	];
}

function linkSummary(links: ReadonlyArray<ImportLinkChoice>): ReadonlyArray<string> {
	const environments = [...new Set(links.map(({ link }) => link.environment))];
	const lines = environments.flatMap((environment) => {
		const inEnvironment = links.filter(({ link }) => link.environment === environment);
		return [`Link in "${environment}":`, ...inEnvironment.flatMap(linkLines)];
	});
	const differs = links.some((choice) => {
		return (candidateOf(choice, choice.link.linked)?.differences.length ?? 0) > 0;
	});
	return differs
		? [...lines, "The next deploy applies the config values to the linked items."]
		: lines;
}

function itemLine(sign: string, { key, item }: { item: ImportItem; key: string }): string {
	return `  ${sign} ${item.kind}:${key} (id ${item.robloxId}) "${item.name}"`;
}

function summaryText({ environment, imports, links = [], untrack }: ImportSummary): string {
	const lines: Array<string> = [];
	if (imports.length > 0) {
		lines.push(`Import from "${environment}":`, ...imports.map((one) => itemLine("+", one)));
	}

	const redacted = imports.filter(({ item }) => item.redacted === true);
	if (redacted.length > 0) {
		const keys = redacted.map(({ key, item }) => `${item.kind}:${key}`).join(", ");
		lines.push(
			`"${environment}" is redacted: its next deploy replaces the live name, description, icon and price of ${keys} with placeholders.`,
		);
	}

	lines.push(...linkSummary(links));
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
