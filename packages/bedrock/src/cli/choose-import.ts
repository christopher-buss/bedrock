import type { Result } from "@bedrock-rbx/ocale";

import type { ImportItem, ImportSelection } from "../core/import-plan-types.ts";
import type { ImportCancelled, ImportChoice, PlanImportLinks } from "../shell/import-items.ts";
import type { ImportKeyChoice, ImportLinkChoice, ImportPromptPort } from "./import-prompt-port.ts";
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
 * edit each one, link the Keys in each other Environment, then confirm the
 * summary. A picked untracked item is imported; a cleared tracked item is
 * untracked. When the pick changes nothing, no later screen is shown.
 *
 * @param inputs - The prompt port, output port and Environment.
 * @param offered - Every live item of the Environment, and the planner of
 *   the links of keyed selections.
 * @returns The choice, or the cancellation of any screen.
 */
export async function chooseImportAsync(
	inputs: ChooseImportInputs,
	{
		items,
		planLinks,
	}: { readonly items: ReadonlyArray<ImportItem>; readonly planLinks: PlanImportLinks },
): Promise<Result<ImportChoice, ImportCancelled>> {
	if (items.length === 0) {
		inputs.clack.logMessage(
			`"${inputs.environment}" has no live game passes, developer products, badges or places to import.`,
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

	return confirmChoiceAsync({ ...inputs, planLinks }, { fresh, untrack });
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

function selectionOf({ key, item: { kind, robloxId } }: ImportKeyChoice): ImportSelection {
	return { key, kind, robloxId };
}

async function linkScreenAsync(
	port: ImportPromptPort,
	{
		environment,
		links,
	}: { readonly environment: string; readonly links: ReadonlyArray<ImportLinkChoice> },
): Promise<Result<ReadonlyArray<ImportLinkChoice>, ImportCancelled>> {
	const toEdit = links.some(({ link }) => link.candidates.length > 0)
		? await port.promptLinksToEdit({ environment, links })
		: { data: [], success: true as const };
	if (!toEdit.success) {
		return toEdit;
	}

	const chosen: Array<ImportLinkChoice> = [];
	for (const choice of links) {
		const linked = toEdit.data.includes(choice)
			? await port.promptLink(choice)
			: { data: choice.link.suggested, success: true as const };
		if (!linked.success) {
			return linked;
		}

		chosen.push({ ...choice, link: { ...choice.link, linked: linked.data } });
	}

	return { data: chosen, success: true };
}

async function linkKeysAsync(
	{ planLinks, port }: Pick<ChooseImportInputs, "port"> & { readonly planLinks: PlanImportLinks },
	imports: ReadonlyArray<ImportKeyChoice>,
): Promise<Result<ReadonlyArray<ImportLinkChoice>, ImportCancelled>> {
	const planned = planLinks(imports.map(selectionOf)).flatMap((link) => {
		return imports
			.filter(({ item }) => item.kind === link.kind && item.robloxId === link.robloxId)
			.map(({ item }) => ({ item, link }));
	});
	const environments = [...new Set(planned.map(({ link }) => link.environment))];
	const chosen: Array<ImportLinkChoice> = [];
	for (const environment of environments) {
		const links = planned.filter(({ link }) => link.environment === environment);
		const screen = await linkScreenAsync(port, { environment, links });
		if (!screen.success) {
			return screen;
		}

		chosen.push(...screen.data);
	}

	return { data: chosen, success: true };
}

function linkedSelection(
	choice: ImportKeyChoice,
	links: ReadonlyArray<ImportLinkChoice>,
): ImportSelection {
	const linked = links.flatMap(({ item, link }) => {
		return item === choice.item && link.linked !== undefined
			? [[link.environment, link.linked] as const]
			: [];
	});
	const selection = selectionOf(choice);
	return linked.length === 0 ? selection : { ...selection, links: Object.fromEntries(linked) };
}

async function confirmChoiceAsync(
	inputs: ChooseImportInputs & { readonly planLinks: PlanImportLinks },
	{
		fresh,
		untrack,
	}: { readonly fresh: ReadonlyArray<ImportItem>; readonly untrack: ReadonlyArray<ImportItem> },
): Promise<Result<ImportChoice, ImportCancelled>> {
	const imports = await editKeysAsync(inputs.port, fresh);
	if (!imports.success) {
		return imports;
	}

	const links = await linkKeysAsync(inputs, imports.data);
	if (!links.success) {
		return links;
	}

	const confirmed = await inputs.port.confirmImport({
		environment: inputs.environment,
		imports: imports.data,
		links: links.data,
		untrack,
	});
	if (!confirmed.success) {
		return confirmed;
	}

	return {
		data: {
			selections: imports.data.map((choice) => linkedSelection(choice, links.data)),
			untrack: untrack.map(({ kind, robloxId }) => ({ kind, robloxId })),
		},
		success: true,
	};
}
