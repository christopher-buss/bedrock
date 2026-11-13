import type { TextOptions } from "@clack/prompts";

import { assert, describe, it, vi } from "vitest";

import type { ImportItem } from "../core/import-plan.ts";
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
				"Badges": [{ hint: "id 14", label: "First Win", value: "badge:14" }],
				"Developer products": [
					{ hint: "id 13", label: "Coins", value: "developerProduct:13" },
				],
				"Game passes": [
					{ hint: "id 11", label: "VIP Pass", value: "gamePass:11" },
					{ hint: "id 12, tracked by 'old'", label: "Old Pass", value: "gamePass:12" },
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
});
