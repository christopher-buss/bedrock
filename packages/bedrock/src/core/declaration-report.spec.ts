import { describe, it } from "vitest";

import { collectDeclarations } from "./declaration-report.ts";
import type { Config } from "./schema.ts";

describe(collectDeclarations, () => {
	it("should collect import lines from every overlay collection with its kind and environment", ({
		expect,
	}) => {
		expect.assertions(1);

		const config: Config = {
			environments: {
				staging: {
					badges: {
						winner: {
							name: "Winner",
							iconBaseline: "accept-local-file",
							importId: "22",
						},
					},
					products: { coins: { name: "Coins", importId: "11" } },
				},
			},
		};

		expect(collectDeclarations(config)).toStrictEqual([
			{
				key: "coins",
				declaration: "importId",
				environment: "staging",
				imported: { environment: "staging", robloxId: "11" },
				oldKey: "coins",
				resourceKind: "developerProduct",
			},
			{
				key: "winner",
				declaration: "importId",
				environment: "staging",
				imported: { environment: "staging", robloxId: "22" },
				oldKey: "winner",
				resourceKind: "badge",
			},
			{
				key: "winner",
				declaration: "iconBaseline",
				environment: "staging",
				imported: { environment: "staging", robloxId: "22" },
				oldKey: "winner",
				resourceKind: "badge",
			},
		]);
	});
});
