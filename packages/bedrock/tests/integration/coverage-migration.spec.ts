import { assert, describe, it } from "vitest";

import { migrateMantleState } from "../../src/index.ts";

const HASH = "908498abb7f4fca2b7d2b050bfe7c48c009202fabd85f489b03bb19ac6e0b1d9";
const encoder = new TextEncoder();

function resource(kind: string, { inputs, outputs }: { inputs: unknown; outputs: unknown }) {
	return {
		id: `${kind}_lobby`,
		dependencies: [],
		inputs: { [kind]: inputs },
		outputs: { [kind]: outputs },
	};
}

describe(migrateMantleState, () => {
	it.for([
		{ inputs: undefined, label: "missing place-file inputs", outputs: { version: 53 } },
		{
			inputs: { fileHash: HASH, filePath: "lobby.rbxl" },
			label: "missing place-file outputs",
			outputs: undefined,
		},
		{
			inputs: { fileHash: HASH, filePath: "lobby.rbxl" },
			label: "invalid place-file version",
			outputs: { version: "53" },
		},
	])("should omit an incomplete place with $label", async ({ inputs, outputs }, { expect }) => {
		expect.assertions(2);

		const result = await migrateMantleState({
			configFormat: "yaml",
			stateFileBytes: encoder.encode(
				JSON.stringify({
					environments: {
						production: [
							resource("experience", {
								inputs: {},
								outputs: { assetId: 6031475575, startPlaceId: 17613681043 },
							}),
							resource("place", {
								inputs: { isStart: true },
								outputs: { assetId: 17613681043 },
							}),
							resource("placeFile", { inputs, outputs }),
						],
					},
					version: "6",
				}),
			),
			stateFilePath: "/project/.mantle-state.yml",
		});
		assert(result.success);

		expect(
			result.data.statesByEnvironment["production"]!.resources.map(({ kind }) => kind),
		).toStrictEqual(["universe"]);
		expect(result.data.config.places).toBeUndefined();
	});

	it.for([
		{ inputs: undefined, label: "missing icon inputs", outputs: { assetId: 123 } },
		{
			inputs: { fileHash: HASH, filePath: "coin.png" },
			label: "missing icon outputs",
			outputs: undefined,
		},
		{
			inputs: { fileHash: HASH, filePath: "coin.png" },
			label: "invalid icon asset ID",
			outputs: { assetId: false },
		},
	])(
		"should preserve a product without adopting its $label",
		async ({ inputs, outputs }, { expect }) => {
			expect.assertions(2);

			const result = await migrateMantleState({
				configFormat: "yaml",
				stateFileBytes: encoder.encode(
					JSON.stringify({
						environments: {
							production: [
								resource("experience", {
									inputs: {},
									outputs: { assetId: 6031475575, startPlaceId: 17613681043 },
								}),
								resource("product", {
									inputs: {
										name: "Coins",
										description: "One coin pack",
										price: 5,
									},
									outputs: { assetId: 100 },
								}),
								resource("productIcon", { inputs, outputs }),
							],
						},
						version: "6",
					}),
				),
				stateFilePath: "/project/.mantle-state.yml",
			});
			assert(result.success);
			const product = result.data.statesByEnvironment["production"]!.resources.find(
				({ kind }) => kind === "developerProduct",
			);

			expect(product).toMatchObject({
				key: "lobby",
				name: "Coins",
				outputs: { iconImageAssetId: undefined, productId: "100" },
			});
			expect(result.data.config.products!["lobby"]).not.toHaveProperty("icon");
		},
	);
});
