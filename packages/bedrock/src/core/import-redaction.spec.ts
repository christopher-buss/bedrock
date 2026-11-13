import { describe, it } from "vitest";

import { asRobloxAssetId } from "../types/ids.ts";
import type { ImportItem, ImportRefusal } from "./import-plan-types.ts";
import { redactedImports } from "./import-redaction.ts";

function item(id: string, fields: Partial<ImportItem> = {}): ImportItem {
	return {
		key: `pass-${id}`,
		name: `Pass ${id}`,
		icon: undefined,
		kind: "gamePass",
		redacted: true,
		robloxId: asRobloxAssetId(id),
		trackedBy: undefined,
		...fields,
	};
}

describe(redactedImports, () => {
	it("should name each imported redacted item by its Kind and written Key", ({ expect }) => {
		expect.assertions(1);

		const items = [item("1"), item("2"), item("3", { kind: "badge" })];

		expect(
			redactedImports(items, {
				refused: [],
				selections: [
					{ kind: "gamePass", robloxId: asRobloxAssetId("1") },
					{ key: "chosen", kind: "gamePass", robloxId: asRobloxAssetId("2") },
					{ kind: "badge", robloxId: asRobloxAssetId("3") },
				],
			}),
		).toStrictEqual(["gamePass:pass-1", "gamePass:chosen", "badge:pass-3"]);
	});

	it("should leave out refused, not redacted and unknown selections", ({ expect }) => {
		expect.assertions(1);

		const refused: ImportRefusal = {
			kind: "gamePass",
			message: "no",
			reason: "tracked",
			robloxId: asRobloxAssetId("1"),
		};
		const { redacted: _redacted, ...plain } = item("2");
		const items = [item("1"), plain, item("4")];

		expect(
			redactedImports(items, {
				refused: [refused, { ...refused, kind: "badge", robloxId: asRobloxAssetId("4") }],
				selections: [
					{ kind: "gamePass", robloxId: asRobloxAssetId("1") },
					{ kind: "gamePass", robloxId: asRobloxAssetId("2") },
					{ kind: "gamePass", robloxId: asRobloxAssetId("3") },
					{ kind: "gamePass", robloxId: asRobloxAssetId("4") },
					{ kind: "badge", robloxId: asRobloxAssetId("1") },
				],
			}),
		).toStrictEqual(["gamePass:pass-4"]);
	});
});
