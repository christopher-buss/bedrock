import { assert, describe, it } from "vitest";

import { flattenConfig } from "./flatten.ts";
import { none } from "./none.ts";
import { validateConfig } from "./schema.ts";
import { selectEnvironment } from "./select-environment.ts";

const ENTRY = { name: "VIP", description: "Perks", icon: { "en-us": "vip.png" } };

describe("managed pricing config", () => {
	it.for(["passes", "products"] as const)(
		"should default managed pricing off when flattening %s without the field",
		(collection, { expect }) => {
			expect.assertions(1);

			const input = flattenConfig({
				[collection]: { vip: ENTRY },
				environments: { production: {} },
			})[0];

			expect(input).toMatchObject({ isManagedPricingEnabled: false });
		},
	);

	it.for(["passes", "products"] as const)(
		"should preserve enabled managed pricing through redaction for %s",
		(collection, { expect }) => {
			expect.assertions(1);

			const config = validateConfig(
				{
					[collection]: {
						vip: {
							...ENTRY,
							isManagedPricingEnabled: true,
							price: 100,
							redacted: true,
						},
					},
					environments: { production: {} },
				},
				"config",
			);
			assert(config.success);
			const resolved = selectEnvironment(config.data, "production");
			assert(resolved.success);

			expect(resolved.data[collection]!["vip"]!.isManagedPricingEnabled).toBeTrue();
		},
	);

	it.for(["passes", "products"] as const)(
		"should reject none on overlay managed pricing for %s",
		(collection, { expect }) => {
			expect.assertions(1);
			expect(
				validateConfig(
					{
						[collection]: { vip: ENTRY },
						environments: {
							production: {
								[collection]: { vip: { isManagedPricingEnabled: none } },
							},
						},
					},
					"config",
				).success,
			).toBeFalse();
		},
	);

	it.for(["passes", "products"] as const)(
		"should inherit and override managed pricing for %s",
		(collection, { expect }) => {
			expect.assertions(3);

			const result = validateConfig(
				{
					[collection]: { vip: { ...ENTRY, isManagedPricingEnabled: true, price: 100 } },
					environments: {
						production: {},
						staging: { [collection]: { vip: { isManagedPricingEnabled: false } } },
					},
				},
				"bedrock.config.ts",
			);
			assert(result.success);

			expect(result.success).toBeTrue();

			const production = selectEnvironment(result.data, "production");
			const staging = selectEnvironment(result.data, "staging");
			assert(production.success && staging.success);

			expect(production.data[collection]!["vip"]!.isManagedPricingEnabled).toBeTrue();
			expect(staging.data[collection]!["vip"]!.isManagedPricingEnabled).toBeFalse();
		},
	);

	it.for(["passes", "products"] as const)(
		"should resolve omitted managed pricing to false for %s",
		(collection, { expect }) => {
			expect.assertions(1);

			const config = validateConfig(
				{ [collection]: { vip: ENTRY }, environments: { production: {} } },
				"config",
			);
			assert(config.success);
			const resolved = selectEnvironment(config.data, "production");
			assert(resolved.success);

			expect(resolved.data[collection]!["vip"]!.isManagedPricingEnabled).toBeFalse();
		},
	);

	it.for(["passes", "products"] as const)(
		"should reject none on managed pricing for %s",
		(collection, { expect }) => {
			expect.assertions(1);
			expect(
				validateConfig(
					{
						[collection]: { vip: { ...ENTRY, isManagedPricingEnabled: none } },
						environments: { production: {} },
					},
					"config",
				).success,
			).toBeFalse();
		},
	);

	it.for(["passes", "products"] as const)(
		"should reject enabled managed pricing without a resolved price for %s",
		(collection, { expect }) => {
			expect.assertions(2);

			const result = validateConfig(
				{
					[collection]: { vip: { ...ENTRY, isManagedPricingEnabled: true, price: 100 } },
					environments: { staging: { [collection]: { vip: { price: none } } } },
				},
				"config",
			);
			assert(!result.success && result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual([
				"environments",
				"staging",
				collection,
				"vip",
				"isManagedPricingEnabled",
			]);
			expect(result.err.issues[0]!.message).toBe(
				`${collection}.vip has managed pricing enabled without a price. Set a price or turn managed pricing off.`,
			);
		},
	);

	it.for([
		{ overlay: {}, root: { isManagedPricingEnabled: true } },
		{ overlay: { isManagedPricingEnabled: true }, root: {} },
		{ overlay: { isManagedPricingEnabled: true }, root: { price: none } },
		{ overlay: { isManagedPricingEnabled: true, price: none }, root: {} },
	] as const)(
		"should reject managed pricing without a price after merging $root and $overlay",
		({ overlay, root }, { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: { staging: { products: { vip: overlay } } },
					products: { vip: { ...ENTRY, ...root } },
				},
				"config",
			);

			expect(result.success).toBeFalse();
		},
	);

	it.for([
		{ expected: true, overlay: { isManagedPricingEnabled: true, price: 0 }, root: {} },
		{ expected: true, overlay: { isManagedPricingEnabled: true }, root: { price: 100 } },
		{
			expected: false,
			overlay: { isManagedPricingEnabled: false, price: none },
			root: { isManagedPricingEnabled: true, price: 100 },
		},
		{
			expected: true,
			overlay: {},
			root: { isManagedPricingEnabled: true, price: 100, redacted: true },
		},
	] as const)(
		"should preserve effective managed pricing for $root and $overlay",
		({ expected, overlay, root }, { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					environments: { staging: { products: { vip: overlay } } },
					products: { vip: { ...ENTRY, ...root } },
				},
				"config",
			);
			assert(result.success);
			const resolved = selectEnvironment(result.data, "staging");
			assert(resolved.success);

			expect(resolved.data.products!["vip"]!.isManagedPricingEnabled).toBe(expected);
		},
	);
});

describe("managed pricing control entries", () => {
	it.for(["passes", "products"] as const)(
		"should let an untrack overlay replace managed %s without requiring an inherited price",
		(collection, { expect }) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					[collection]: { vip: { ...ENTRY, isManagedPricingEnabled: true } },
					environments: { production: { [collection]: { vip: { retired: "untrack" } } } },
				},
				"config",
			);
			assert(result.success);
			const resolved = selectEnvironment(result.data, "production");
			assert(resolved.success);

			expect(resolved.data[collection]).toStrictEqual({ vip: { retired: "untrack" } });
		},
	);

	it.for(["passes", "products"] as const)(
		"should report only the retired overlay issue when an overlay enables managed %s under a retired root",
		(collection, { expect }) => {
			expect.assertions(2);

			const result = validateConfig(
				{
					[collection]: { vip: { retired: true } },
					environments: {
						production: { [collection]: { vip: { isManagedPricingEnabled: true } } },
					},
				},
				"config",
			);
			assert(!result.success && result.err.kind === "validationFailed");

			expect(result.err.issues).toHaveLength(1);
			expect(result.err.issues[0]!.message).toBe(
				`${collection}.vip is retired at the root, so environment "production" may only set retired on it.`,
			);
		},
	);
});
