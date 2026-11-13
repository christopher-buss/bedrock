import type { TextOptions } from "@clack/prompts";

import { assert, describe, it, vi } from "vitest";

import type { ImportLink } from "../core/import-links.ts";
import type { ImportItem } from "../core/import-plan-types.ts";
import { asRobloxAssetId } from "../types/ids.ts";
import {
	createDefaultImportPromptPort,
	type ImportPromptClackHelpers,
} from "./default-import-prompt-port.ts";

const CANCEL_SENTINEL = Symbol("clack-cancel");

function validatorOf({ validate }: TextOptions): (value: string | undefined) => unknown {
	assert(typeof validate === "function", "text prompt has no validate function");
	return validate;
}

function fakeIsCancel(value: unknown): value is symbol {
	return value === CANCEL_SENTINEL;
}

function makeHelpers(overrides: Partial<ImportPromptClackHelpers> = {}): ImportPromptClackHelpers {
	return {
		confirm: vi.fn<ImportPromptClackHelpers["confirm"]>(),
		groupMultiselect: vi.fn<ImportPromptClackHelpers["groupMultiselect"]>(),
		isCancel: fakeIsCancel,
		multiselect: vi.fn<ImportPromptClackHelpers["multiselect"]>(),
		note: vi.fn<ImportPromptClackHelpers["note"]>(),
		select: vi.fn<ImportPromptClackHelpers["select"]>(),
		text: vi.fn<ImportPromptClackHelpers["text"]>(),
		...overrides,
	};
}

const VIP: ImportItem = {
	key: "vip-pass",
	name: "VIP Pass",
	icon: undefined,
	kind: "gamePass",
	robloxId: asRobloxAssetId("11"),
	trackedBy: undefined,
};

const OLD: ImportItem = {
	key: "old",
	name: "Old Pass",
	icon: undefined,
	kind: "gamePass",
	robloxId: asRobloxAssetId("12"),
	trackedBy: "old",
};

const COINS: ImportItem = {
	key: "coins",
	name: "Coins",
	icon: undefined,
	kind: "developerProduct",
	robloxId: asRobloxAssetId("13"),
	trackedBy: undefined,
};

const WIN: ImportItem = {
	key: "first-win",
	name: "First Win",
	icon: undefined,
	kind: "badge",
	robloxId: asRobloxAssetId("14"),
	trackedBy: undefined,
};

const CANCELLED = { err: { kind: "cancelled" }, success: false };

const LINK: ImportLink = {
	key: "vip",
	candidates: [
		{
			name: "[STAGING] VIP Pass",
			differences: [
				{ config: "VIP Pass", field: "name", live: "[STAGING] VIP Pass" },
				{ config: 100, field: "price", live: 90 },
			],
			robloxId: asRobloxAssetId("21"),
		},
		{ name: "Gold", differences: [], robloxId: asRobloxAssetId("22") },
	],
	environment: "staging",
	kind: "gamePass",
	linked: undefined,
	robloxId: asRobloxAssetId("11"),
	suggested: asRobloxAssetId("21"),
};

const COINS_LINK: ImportLink = {
	...LINK,
	key: "coins",
	candidates: [],
	kind: "developerProduct",
	robloxId: asRobloxAssetId("13"),
	suggested: undefined,
};

describe(createDefaultImportPromptPort, () => {
	it("should group the items by Kind with tracked items selected and return the picked items", async ({
		expect,
	}) => {
		expect.assertions(2);

		const groupMultiselect = vi.fn<ImportPromptClackHelpers["groupMultiselect"]>(async () => {
			return ["gamePass:11", "badge:14", "gamePass:99"];
		});
		const port = createDefaultImportPromptPort(makeHelpers({ groupMultiselect }));

		const result = await port.promptItems([VIP, OLD, COINS, WIN]);

		expect(result).toStrictEqual({ data: [VIP, WIN], success: true });
		expect(groupMultiselect).toHaveBeenCalledExactlyOnceWith({
			initialValues: ["gamePass:12"],
			message:
				"Select the items to import. Tracked items start selected; clear one to stop tracking it.",
			options: {
				"Badges": [
					{ disabled: false, hint: "id 14", label: "First Win", value: "badge:14" },
				],
				"Developer products": [
					{
						disabled: false,
						hint: "id 13",
						label: "Coins",
						value: "developerProduct:13",
					},
				],
				"Game passes": [
					{ disabled: false, hint: "id 11", label: "VIP Pass", value: "gamePass:11" },
					{
						disabled: false,
						hint: "id 12, tracked by 'old'",
						label: "Old Pass",
						value: "gamePass:12",
					},
				],
			},
			required: false,
		});
	});

	it("should list the Keys to edit with none selected and return the picked items", async ({
		expect,
	}) => {
		expect.assertions(2);

		const multiselect = vi.fn<ImportPromptClackHelpers["multiselect"]>(async () => {
			return ["developerProduct:13"];
		});
		const port = createDefaultImportPromptPort(makeHelpers({ multiselect }));

		const result = await port.promptKeysToEdit([VIP, COINS]);

		expect(result).toStrictEqual({ data: [COINS], success: true });
		expect(multiselect).toHaveBeenCalledExactlyOnceWith({
			message: "Edit the Key of which items? Select none to keep the suggested Keys.",
			options: [
				{ hint: "VIP Pass", label: "vip-pass", value: "gamePass:11" },
				{ hint: "Coins", label: "coins", value: "developerProduct:13" },
			],
			required: false,
		});
	});

	it("should ask for a Key starting from the suggestion and refuse an invalid one", async ({
		expect,
	}) => {
		expect.assertions(4);

		const text = vi.fn<ImportPromptClackHelpers["text"]>(async () => "vip");
		const port = createDefaultImportPromptPort(makeHelpers({ text }));

		const result = await port.promptKey(VIP);

		expect(result).toStrictEqual({ data: "vip", success: true });

		const [options] = text.mock.calls[0]!;

		expect(options).toMatchObject({ initialValue: "vip-pass", message: 'Key for "VIP Pass"' });
		expect(validatorOf(options)("not a key")).toBe("Use letters, digits, - and _ only.");
		expect(validatorOf(options)(undefined)).toBe("Use letters, digits, - and _ only.");
	});

	it("should accept a valid Key", async ({ expect }) => {
		expect.assertions(1);

		const text = vi.fn<ImportPromptClackHelpers["text"]>(async () => "vip");
		const port = createDefaultImportPromptPort(makeHelpers({ text }));
		await port.promptKey(VIP);

		expect(validatorOf(text.mock.calls[0]![0])("vip_2")).toBeUndefined();
	});

	it("should show the summary and resolve when the user confirms", async ({ expect }) => {
		expect.assertions(3);

		const confirm = vi.fn<ImportPromptClackHelpers["confirm"]>(async () => true);
		const note = vi.fn<ImportPromptClackHelpers["note"]>();
		const port = createDefaultImportPromptPort(makeHelpers({ confirm, note }));

		const result = await port.confirmImport({
			environment: "production",
			imports: [{ key: "vip", item: VIP }],
			untrack: [OLD],
		});

		expect(result).toStrictEqual({ data: undefined, success: true });
		expect(note).toHaveBeenCalledExactlyOnceWith(
			'Import from "production":\n  + gamePass:vip (id 11) "VIP Pass"\nStop tracking (retired: "untrack"):\n  - gamePass:old (id 12) "Old Pass"',
			"Summary",
		);
		expect(confirm).toHaveBeenCalledExactlyOnceWith({
			message: "Write these changes to the config?",
		});
	});

	it("should warn that the next deploy redacts the imported items the source Environment redacts", async ({
		expect,
	}) => {
		expect.assertions(1);

		const note = vi.fn<ImportPromptClackHelpers["note"]>();
		const port = createDefaultImportPromptPort(
			makeHelpers({ confirm: async () => true, note }),
		);

		await port.confirmImport({
			environment: "staging",
			imports: [
				{ key: "vip", item: { ...VIP, redacted: true } },
				{ key: "coins", item: COINS },
				{ key: "first-win", item: { ...WIN, redacted: true } },
			],
			untrack: [],
		});

		expect(note).toHaveBeenCalledExactlyOnceWith(
			[
				'Import from "staging":',
				'  + gamePass:vip (id 11) "VIP Pass"',
				'  + developerProduct:coins (id 13) "Coins"',
				'  + badge:first-win (id 14) "First Win"',
				'"staging" is redacted: its next deploy replaces the live name, description, icon and price of gamePass:vip, badge:first-win with placeholders.',
			].join("\n"),
			"Summary",
		);
	});

	it("should leave out an empty part of the summary", async ({ expect }) => {
		expect.assertions(2);

		const note = vi.fn<ImportPromptClackHelpers["note"]>();
		const port = createDefaultImportPromptPort(
			makeHelpers({ confirm: async () => true, note }),
		);

		await port.confirmImport({ environment: "production", imports: [], untrack: [OLD] });
		await port.confirmImport({
			environment: "production",
			imports: [{ key: "vip", item: VIP }],
			untrack: [],
		});

		expect(note).toHaveBeenNthCalledWith(
			1,
			'Stop tracking (retired: "untrack"):\n  - gamePass:old (id 12) "Old Pass"',
			"Summary",
		);
		expect(note).toHaveBeenNthCalledWith(
			2,
			'Import from "production":\n  + gamePass:vip (id 11) "VIP Pass"',
			"Summary",
		);
	});

	it("should treat a declined confirmation as a cancellation", async ({ expect }) => {
		expect.assertions(1);

		const port = createDefaultImportPromptPort(makeHelpers({ confirm: async () => false }));

		await expect(
			port.confirmImport({ environment: "production", imports: [], untrack: [] }),
		).resolves.toStrictEqual(CANCELLED);
	});

	it("should map a clack cancel on every screen into a cancellation", async ({ expect }) => {
		expect.assertions(4);

		const port = createDefaultImportPromptPort(
			makeHelpers({
				confirm: async () => CANCEL_SENTINEL,
				groupMultiselect: async () => CANCEL_SENTINEL,
				multiselect: async () => CANCEL_SENTINEL,
				text: async () => CANCEL_SENTINEL,
			}),
		);

		await expect(port.promptItems([VIP])).resolves.toStrictEqual(CANCELLED);
		await expect(port.promptKeysToEdit([VIP])).resolves.toStrictEqual(CANCELLED);
		await expect(port.promptKey(VIP)).resolves.toStrictEqual(CANCELLED);
		await expect(
			port.confirmImport({ environment: "production", imports: [], untrack: [] }),
		).resolves.toStrictEqual(CANCELLED);
	});

	it("should show an item only one Environment has as disabled and say why", async ({
		expect,
	}) => {
		expect.assertions(1);

		const groupMultiselect = vi.fn<ImportPromptClackHelpers["groupMultiselect"]>(
			async () => [],
		);
		const port = createDefaultImportPromptPort(makeHelpers({ groupMultiselect }));
		const unavailable = {
			kind: "gamePass",
			message: "only here",
			reason: "onlyOneEnvironment",
			robloxId: VIP.robloxId,
		} as const;

		await port.promptItems([{ ...VIP, unavailable }]);

		expect(groupMultiselect.mock.calls[0]![0].options).toStrictEqual({
			"Game passes": [
				{
					disabled: true,
					hint: "id 11, not importable yet: no other Environment has an item to link it to, so a deploy would create it there",
					label: "VIP Pass",
					value: "gamePass:11",
				},
			],
		});
	});

	it("should list the suggested link of each Key and return the Keys to link by hand", async ({
		expect,
	}) => {
		expect.assertions(2);

		const multiselect = vi.fn<ImportPromptClackHelpers["multiselect"]>(async () => {
			return ["developerProduct:13"];
		});
		const port = createDefaultImportPromptPort(makeHelpers({ multiselect }));
		const vip = { item: VIP, link: LINK };
		const coins = { item: COINS, link: COINS_LINK };

		const result = await port.promptLinksToEdit({
			environment: "staging",
			links: [vip, coins],
		});

		expect(multiselect).toHaveBeenCalledExactlyOnceWith({
			message:
				'Links in "staging". Link which Keys by hand? The others take the suggested item.',
			options: [
				{
					hint: '-> "[STAGING] VIP Pass" (id 21), differs in name, price',
					label: "gamePass:vip",
					value: "gamePass:11",
				},
				{
					hint: "no same-name item: unlinked, the next deploy creates it",
					label: "developerProduct:coins",
					value: "developerProduct:13",
				},
			],
			required: false,
		});
		expect(result).toStrictEqual({ data: [coins], success: true });
	});

	it("should offer every candidate and leaving the Key unlinked, starting from the suggestion", async ({
		expect,
	}) => {
		expect.assertions(4);

		const select = vi
			.fn<ImportPromptClackHelpers["select"]>()
			.mockResolvedValueOnce("22")
			.mockResolvedValueOnce("");
		const port = createDefaultImportPromptPort(makeHelpers({ select }));

		const linked = await port.promptLink({ item: VIP, link: LINK });
		const unlinked = await port.promptLink({ item: COINS, link: COINS_LINK });

		expect(select).toHaveBeenNthCalledWith(1, {
			initialValue: "21",
			message: 'Link gamePass:vip in "staging" to',
			options: [
				{
					hint: "id 21, suggested, differs in name, price",
					label: "[STAGING] VIP Pass",
					value: "21",
				},
				{ hint: "id 22", label: "Gold", value: "22" },
				{ hint: "the next deploy creates it", label: "Leave unlinked", value: "" },
			],
		});
		expect(select.mock.calls[1]![0].initialValue).toBe("");
		expect(linked).toStrictEqual({ data: "22", success: true });
		expect(unlinked).toStrictEqual({ data: undefined, success: true });
	});

	it("should show each link with its differing fields in the summary", async ({ expect }) => {
		expect.assertions(3);

		const note = vi.fn<ImportPromptClackHelpers["note"]>();
		const port = createDefaultImportPromptPort(
			makeHelpers({ confirm: async () => true, note }),
		);

		await port.confirmImport({
			environment: "production",
			imports: [{ key: "vip", item: VIP }],
			links: [
				{ item: VIP, link: { ...LINK, linked: asRobloxAssetId("21") } },
				{ item: COINS, link: { ...COINS_LINK, environment: "qa" } },
			],
			untrack: [],
		});
		await port.confirmImport({
			environment: "production",
			imports: [{ key: "vip", item: VIP }],
			links: [{ item: VIP, link: { ...LINK, linked: asRobloxAssetId("22") } }],
			untrack: [],
		});
		await port.confirmImport({
			environment: "production",
			imports: [{ key: "coins", item: COINS }],
			links: [{ item: COINS, link: COINS_LINK }],
			untrack: [],
		});

		expect(note).toHaveBeenNthCalledWith(
			1,
			[
				'Import from "production":',
				'  + gamePass:vip (id 11) "VIP Pass"',
				'Link in "staging":',
				'  = gamePass:vip -> id 21 "[STAGING] VIP Pass"',
				'      name: "[STAGING] VIP Pass" live, "VIP Pass" in config',
				"      price: 90 live, 100 in config",
				'Link in "qa":',
				"  + developerProduct:coins not linked: the next deploy creates it",
				"The next deploy applies the config values to the linked items.",
			].join("\n"),
			"Summary",
		);
		expect(note).toHaveBeenNthCalledWith(
			2,
			[
				'Import from "production":',
				'  + gamePass:vip (id 11) "VIP Pass"',
				'Link in "staging":',
				'  = gamePass:vip -> id 22 "Gold"',
			].join("\n"),
			"Summary",
		);
		expect(note).toHaveBeenNthCalledWith(
			3,
			[
				'Import from "production":',
				'  + developerProduct:coins (id 13) "Coins"',
				'Link in "staging":',
				"  + developerProduct:coins not linked: the next deploy creates it",
			].join("\n"),
			"Summary",
		);
	});

	it("should map a clack cancel on the link screens into a cancellation", async ({ expect }) => {
		expect.assertions(2);

		const port = createDefaultImportPromptPort(
			makeHelpers({
				multiselect: async () => CANCEL_SENTINEL,
				select: async () => CANCEL_SENTINEL,
			}),
		);

		await expect(
			port.promptLinksToEdit({ environment: "staging", links: [{ item: VIP, link: LINK }] }),
		).resolves.toStrictEqual(CANCELLED);
		await expect(port.promptLink({ item: VIP, link: LINK })).resolves.toStrictEqual(CANCELLED);
	});
});
