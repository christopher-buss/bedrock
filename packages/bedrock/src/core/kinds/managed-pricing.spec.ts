import { ArkErrors } from "arktype";
import { assert, describe, it } from "vitest";

import {
	developerProductCurrent,
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
	ValidDeveloperProductEntry,
	ValidGamePassEntry,
} from "#tests/helpers/resources";
import { diff } from "../diff.ts";
import { none } from "../none.ts";
import { parseStateFile, serializeStateFile } from "../state-file.ts";
import { developerProductKind } from "./developer-product.ts";
import { gamePassKind } from "./game-pass.ts";

const PRICING_CASES = [
	[{ isManagedPricingEnabled: true }, true],
	[{ isManagedPricingEnabled: false }, false],
	[{}, false],
] as const;

describe("managed pricing desired state", () => {
	it("should normalize legacy desired inputs to disabled pricing for both kinds", async ({
		expect,
	}) => {
		expect.assertions(2);

		const io = { readFile: async () => new Uint8Array() };
		const pass = await gamePassKind.normalize(gamePassDesired(), io);
		const product = await developerProductKind.normalize(developerProductDesired(), io);
		assert(pass.success && product.success);

		expect(pass.data.isManagedPricingEnabled).toBeFalse();
		expect(product.data.isManagedPricingEnabled).toBeFalse();
	});

	it.for([none, "true", 1])(
		"should reject %s as a managed-pricing entry value",
		(value, { expect }) => {
			expect.assertions(2);
			expect(
				gamePassKind.entrySchema({ ...ValidGamePassEntry, isManagedPricingEnabled: value }),
			).toBeInstanceOf(ArkErrors);
			expect(
				developerProductKind.entrySchema({
					...ValidDeveloperProductEntry,
					isManagedPricingEnabled: value,
				}),
			).toBeInstanceOf(ArkErrors);
		},
	);

	it.for(PRICING_CASES)(
		"should carry developer-product managed pricing %s through flattening and normalization",
		async ([fields, expected], { expect }) => {
			expect.assertions(2);

			const input = developerProductKind.flatten({
				environments: { production: {} },
				products: {
					gems: {
						name: "Gems",
						description: "Premium gems",
						price: 100,
						...fields,
					},
				},
			})[0]!;

			assert(!("retired" in input));

			expect(input.isManagedPricingEnabled).toBe(expected);

			const result = await developerProductKind.normalize(input, {
				readFile: async () => new Uint8Array(),
			});
			assert(result.success);

			expect(result.data.isManagedPricingEnabled).toBe(expected);
		},
	);

	it.for(PRICING_CASES)(
		"should carry game-pass managed pricing %s through flattening and normalization",
		async ([fields, expected], { expect }) => {
			expect.assertions(2);

			const input = gamePassKind.flatten({
				environments: { production: {} },
				passes: {
					vip: {
						name: "VIP",
						description: "VIP perks",
						icon: { "en-us": "vip.png" },
						price: 100,
						...fields,
					},
				},
			})[0]!;

			assert(!("retired" in input));

			expect(input.isManagedPricingEnabled).toBe(expected);

			const result = await gamePassKind.normalize(input, {
				readFile: async () => new Uint8Array(),
			});
			assert(result.success);

			expect(result.data.isManagedPricingEnabled).toBe(expected);
		},
	);
});

describe("managed pricing state", () => {
	it.for(PRICING_CASES)(
		"should preserve managed pricing %s across state serialization",
		([fields], { expect }) => {
			expect.assertions(1);

			const state = {
				environment: "production",
				resources: [
					gamePassCurrent(fields),
					developerProductCurrent({ price: 100, ...fields }),
				],
				version: 1,
			} as const;
			const parsed = parseStateFile(serializeStateFile(state), "state.json");
			assert(parsed.success);

			expect(parsed.data).toStrictEqual(state);
		},
	);
});

describe("managed pricing drift", () => {
	it("should report managed-pricing updates when an omitted config flag must turn off current pricing", ({
		expect,
	}) => {
		expect.assertions(2);

		const operations = diff(
			[gamePassDesired(), developerProductDesired()],
			[
				gamePassCurrent({ isManagedPricingEnabled: true }),
				developerProductCurrent({ isManagedPricingEnabled: true }),
			],
		);

		expect(operations.map((operation) => operation.type)).toStrictEqual(["update", "update"]);

		const pass = operations[0]!;
		const product = operations[1]!;
		assert(pass.type === "update" && product.type === "update");

		expect([pass.changedFields, product.changedFields]).toStrictEqual([
			["isManagedPricingEnabled"],
			["isManagedPricingEnabled"],
		]);
	});

	it.for([
		[
			{ isManagedPricingEnabled: true },
			{ isManagedPricingEnabled: false },
			["isManagedPricingEnabled"],
			false,
		],
		[
			{ isManagedPricingEnabled: false },
			{ isManagedPricingEnabled: true },
			["isManagedPricingEnabled"],
			false,
		],
		[{ isManagedPricingEnabled: true }, { isManagedPricingEnabled: true }, [], true],
		[{ isManagedPricingEnabled: false }, { isManagedPricingEnabled: false }, [], true],
		[{}, { isManagedPricingEnabled: true }, ["isManagedPricingEnabled"], false],
		[{ isManagedPricingEnabled: true }, {}, ["isManagedPricingEnabled"], false],
		[{}, { isManagedPricingEnabled: false }, [], true],
		[{ isManagedPricingEnabled: false }, {}, [], true],
		[{}, {}, [], true],
	] as const)(
		"should compare desired %s and current %s pricing for both kinds",
		([desiredFields, currentFields, expectedFields, equal], { expect }) => {
			expect.assertions(4);

			expect(
				gamePassKind.fieldsEqual(
					gamePassDesired(desiredFields),
					gamePassCurrent(currentFields),
				),
			).toBe(equal);
			expect(
				gamePassKind.changedFieldsBetween(
					gamePassDesired(desiredFields),
					gamePassCurrent(currentFields),
				),
			).toStrictEqual(expectedFields);
			expect(
				developerProductKind.fieldsEqual(
					developerProductDesired(desiredFields),
					developerProductCurrent(currentFields),
				),
			).toBe(equal);
			expect(
				developerProductKind.changedFieldsBetween(
					developerProductDesired(desiredFields),
					developerProductCurrent(currentFields),
				),
			).toStrictEqual(expectedFields);
		},
	);
});
