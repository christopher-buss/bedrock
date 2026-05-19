import { assert, describe, expect, it } from "vitest";

import {
	applyRedaction,
	collectRedactionAnnotations,
	defaultRedactedProductName,
	REDACTED_DESCRIPTION,
	REDACTED_PASS_NAME,
	REDACTED_PRICE,
	REDACTED_PRODUCT_NAME,
	redactedNameSuffix,
} from "./redact-resources.ts";
import { REDACTED_ICON_PATH } from "./redacted-icon.ts";
import type {
	DeveloperProductEntry,
	GamePassEntry,
	ResolvedConfig,
	ResolvedPlaceEntry,
} from "./schema.ts";

const baseConfig: ResolvedConfig = {
	environments: { production: {} },
};

const vipEntry = {
	name: "VIP Pass",
	description: "Grants VIP perks.",
	icon: { "en-us": "assets/vip.png" },
	price: 500,
} as const satisfies GamePassEntry;

const gemPackEntry = {
	name: "Gem Pack",
	description: "Stocks the player up with 1,000 premium gems.",
	icon: { "en-us": "assets/gems.png" },
	price: 100,
} as const satisfies DeveloperProductEntry;

const startPlaceEntry = {
	description: "The lobby place.",
	displayName: "Start Place",
	filePath: "places/start.rbxl",
	placeId: "4711",
} as const satisfies ResolvedPlaceEntry;

describe("redacted price default", () => {
	it("should pin REDACTED_PRICE to 99999 robux as a fail-safe deterrent", () => {
		expect.assertions(1);
		// 99_999 is a deterrent default: a misconfigured redacted resource
		// priced this high is merely embarrassing, whereas one priced near
		// zero risks revenue loss and premature reveal of monetization
		// metadata.
		expect(REDACTED_PRICE).toBe(99_999);
	});
});

describe(applyRedaction, () => {
	it("should replace name, description, icon, and price with placeholders when redacted is true", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			passes: { "vip-pass": { ...vipEntry, redacted: true } },
		});

		expect(result.passes?.["vip-pass"]).toStrictEqual({
			name: REDACTED_PASS_NAME,
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			price: REDACTED_PRICE,
			redacted: true,
		});
	});

	it("should preserve an off-sale pass as off-sale when redacted is true", () => {
		expect.assertions(1);

		const offSale = {
			name: "Coming Soon Pass",
			description: "Reveal at launch.",
			icon: { "en-us": "assets/soon.png" },
		} as const satisfies GamePassEntry;

		const result = applyRedaction({
			...baseConfig,
			passes: { "soon-pass": { ...offSale, redacted: true } },
		});

		expect(result.passes?.["soon-pass"]).toStrictEqual({
			name: REDACTED_PASS_NAME,
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			redacted: true,
		});
	});

	it("should substitute the price override on a redacted pass while leaving other fields at defaults", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			passes: { "vip-pass": { ...vipEntry, redacted: { price: 500 } } },
		});

		expect(result.passes?.["vip-pass"]).toStrictEqual({
			name: REDACTED_PASS_NAME,
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			price: 500,
			redacted: { price: 500 },
		});
	});

	it("should honour a price override of 0 on a redacted pass without falling back to the default", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			passes: { "vip-pass": { ...vipEntry, redacted: { price: 0 } } },
		});

		expect(result.passes?.["vip-pass"]?.price).toBe(0);
	});

	it("should ignore a price override on a redacted pass that is off-sale", () => {
		expect.assertions(1);

		const offSale = {
			name: "Coming Soon Pass",
			description: "Reveal at launch.",
			icon: { "en-us": "assets/soon.png" },
		} as const satisfies GamePassEntry;

		const result = applyRedaction({
			...baseConfig,
			passes: { "soon-pass": { ...offSale, redacted: { price: 500 } } },
		});

		expect(result.passes?.["soon-pass"]).not.toHaveProperty("price");
	});

	it("should leave a pass unchanged when redacted is false", () => {
		expect.assertions(1);

		const entry = { ...vipEntry, redacted: false } as const satisfies GamePassEntry;
		const result = applyRedaction({
			...baseConfig,
			passes: { "vip-pass": entry },
		});

		expect(result.passes?.["vip-pass"]).toStrictEqual(entry);
	});

	it("should leave a pass unchanged when redacted is omitted", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			passes: { "vip-pass": vipEntry },
		});

		expect(result.passes?.["vip-pass"]).toStrictEqual(vipEntry);
	});

	it("should return the config unchanged when no passes collection is declared", () => {
		expect.assertions(1);
		expect(applyRedaction(baseConfig)).toStrictEqual(baseConfig);
	});

	it("should pass through products, places, and universe collections verbatim when no redaction applies", () => {
		expect.assertions(3);

		const input: ResolvedConfig = {
			...baseConfig,
			passes: { "vip-pass": { ...vipEntry, redacted: true } },
			places: {
				"start-place": { filePath: "places/start.rbxl", placeId: "4711" },
			},
			products: {
				"gem-pack": { name: "Gem Pack", description: "Premium gems." },
			},
			universe: { universeId: "1234567890" },
		};

		const result = applyRedaction(input);

		expect(result.places).toBe(input.places);
		expect(result.products).toBe(input.products);
		expect(result.universe).toBe(input.universe);
	});

	it("should preserve the passes reference when no entry needs redaction", () => {
		expect.assertions(1);

		const input: ResolvedConfig = {
			...baseConfig,
			passes: { "vip-pass": vipEntry },
		};

		const result = applyRedaction(input);

		expect(result.passes).toBe(input.passes);
	});

	it("should return the input config when no resource needs redaction", () => {
		expect.assertions(1);

		const input: ResolvedConfig = {
			...baseConfig,
			passes: { "vip-pass": vipEntry },
			places: { "start-place": { filePath: "places/start.rbxl", placeId: "4711" } },
			products: { "gem-pack": gemPackEntry },
		};

		expect(applyRedaction(input)).toBe(input);
	});

	it("should not mutate the input config when redacting a pass", () => {
		expect.assertions(2);

		const passes = { "vip-pass": { ...vipEntry, redacted: true } };
		const input = { ...baseConfig, passes } as const satisfies ResolvedConfig;

		const result = applyRedaction(input);

		expect(input.passes["vip-pass"]).toStrictEqual({ ...vipEntry, redacted: true });
		expect(result.passes?.["vip-pass"]).not.toBe(input.passes["vip-pass"]);
	});

	it("should substitute only the supplied override fields and fall back to defaults for the rest", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			passes: {
				"vip-pass": { ...vipEntry, redacted: { name: "Closed Beta" } },
			},
		});

		expect(result.passes?.["vip-pass"]).toStrictEqual({
			name: "Closed Beta",
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			price: REDACTED_PRICE,
			redacted: { name: "Closed Beta" },
		});
	});

	it("should substitute every field when the override object supplies name, description, and icon", () => {
		expect.assertions(1);

		const override = {
			name: "Beta Pass",
			description: "Beta description",
			icon: { "en-us": "assets/beta.png" },
		};

		const result = applyRedaction({
			...baseConfig,
			passes: { "vip-pass": { ...vipEntry, redacted: override } },
		});

		expect(result.passes?.["vip-pass"]).toStrictEqual({
			name: "Beta Pass",
			description: "Beta description",
			icon: { "en-us": "assets/beta.png" },
			price: REDACTED_PRICE,
			redacted: override,
		});
	});

	it("should substitute the icon override path while leaving non-icon fields at defaults", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			passes: {
				"vip-pass": {
					...vipEntry,
					redacted: { icon: { "en-us": "assets/override-icon.png" } },
				},
			},
		});

		expect(result.passes?.["vip-pass"]).toStrictEqual({
			name: REDACTED_PASS_NAME,
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": "assets/override-icon.png" },
			price: REDACTED_PRICE,
			redacted: { icon: { "en-us": "assets/override-icon.png" } },
		});
	});

	it.for([
		{
			caseName: "no flags set",
			entryRedacted: undefined,
			envRedacted: undefined,
			expectRedacted: false,
		},
		{
			caseName: "env-level true, no resource flag",
			entryRedacted: undefined,
			envRedacted: true,
			expectRedacted: true,
		},
		{
			caseName: "env-level false, no resource flag",
			entryRedacted: undefined,
			envRedacted: false,
			expectRedacted: false,
		},
		{
			caseName: "resource false carves out env-level true",
			entryRedacted: false,
			envRedacted: true,
			expectRedacted: false,
		},
		{
			caseName: "resource true redacts despite env-level false",
			entryRedacted: true,
			envRedacted: false,
			expectRedacted: true,
		},
	] as const)(
		"should redact a pass according to overlay > root > env precedence ($caseName)",
		({ entryRedacted, envRedacted, expectRedacted }) => {
			expect.assertions(1);

			const passEntry = (
				entryRedacted === undefined ? vipEntry : { ...vipEntry, redacted: entryRedacted }
			) satisfies GamePassEntry;
			const result = applyRedaction(
				{ ...baseConfig, passes: { "vip-pass": passEntry } },
				envRedacted,
			);
			const expectedName = expectRedacted ? REDACTED_PASS_NAME : vipEntry.name;

			expect(result.passes?.["vip-pass"]?.name).toBe(expectedName);
		},
	);

	it("should redact description and preserve displayName on a place when redacted is true", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			places: {
				"start-place": { ...startPlaceEntry, redacted: true },
			},
		});

		expect(result.places?.["start-place"]).toStrictEqual({
			...startPlaceEntry,
			description: REDACTED_DESCRIPTION,
			redacted: true,
		});
	});

	it("should leave a place unchanged when redacted is false", () => {
		expect.assertions(1);

		const entry = { ...startPlaceEntry, redacted: false } as const satisfies ResolvedPlaceEntry;
		const result = applyRedaction({
			...baseConfig,
			places: { "start-place": entry },
		});

		expect(result.places?.["start-place"]).toStrictEqual(entry);
	});

	it("should leave a place unchanged when redacted is omitted", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			places: { "start-place": startPlaceEntry },
		});

		expect(result.places?.["start-place"]).toStrictEqual(startPlaceEntry);
	});

	it("should substitute displayName only when supplied explicitly in the override", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			places: {
				"start-place": {
					...startPlaceEntry,
					redacted: { displayName: "Hidden Project" },
				},
			},
		});

		expect(result.places?.["start-place"]).toStrictEqual({
			...startPlaceEntry,
			description: REDACTED_DESCRIPTION,
			displayName: "Hidden Project",
			redacted: { displayName: "Hidden Project" },
		});
	});

	it("should substitute both description and displayName when the override supplies both", () => {
		expect.assertions(1);

		const override = { description: "Coming soon.", displayName: "Hidden" };
		const result = applyRedaction({
			...baseConfig,
			places: {
				"start-place": { ...startPlaceEntry, redacted: override },
			},
		});

		expect(result.places?.["start-place"]).toStrictEqual({
			...startPlaceEntry,
			description: "Coming soon.",
			displayName: "Hidden",
			redacted: override,
		});
	});

	it("should preserve a real displayName when redacted true cascades from the environment", () => {
		expect.assertions(2);

		const result = applyRedaction(
			{ ...baseConfig, places: { "start-place": startPlaceEntry } },
			true,
		);

		expect(result.places?.["start-place"]?.description).toBe(REDACTED_DESCRIPTION);
		expect(result.places?.["start-place"]?.displayName).toBe(startPlaceEntry.displayName);
	});

	it("should not mutate the input config when redacting a place", () => {
		expect.assertions(2);

		const places = { "start-place": { ...startPlaceEntry, redacted: true } };
		const input = { ...baseConfig, places } as const satisfies ResolvedConfig;

		const result = applyRedaction(input);

		expect(input.places["start-place"]).toStrictEqual({ ...startPlaceEntry, redacted: true });
		expect(result.places?.["start-place"]).not.toBe(input.places["start-place"]);
	});

	it.for([
		{
			caseName: "no flags set",
			entryRedacted: undefined,
			envRedacted: undefined,
			expectRedacted: false,
		},
		{
			caseName: "env-level true, no resource flag",
			entryRedacted: undefined,
			envRedacted: true,
			expectRedacted: true,
		},
		{
			caseName: "env-level false, no resource flag",
			entryRedacted: undefined,
			envRedacted: false,
			expectRedacted: false,
		},
		{
			caseName: "resource false carves out env-level true",
			entryRedacted: false,
			envRedacted: true,
			expectRedacted: false,
		},
		{
			caseName: "resource true redacts despite env-level false",
			entryRedacted: true,
			envRedacted: false,
			expectRedacted: true,
		},
	] as const)(
		"should redact a place description according to overlay > root > env precedence ($caseName)",
		({ entryRedacted, envRedacted, expectRedacted }) => {
			expect.assertions(1);

			const placeEntry = (
				entryRedacted === undefined
					? startPlaceEntry
					: { ...startPlaceEntry, redacted: entryRedacted }
			) satisfies ResolvedPlaceEntry;
			const result = applyRedaction(
				{ ...baseConfig, places: { "start-place": placeEntry } },
				envRedacted,
			);
			const expectedDescription = expectRedacted
				? REDACTED_DESCRIPTION
				: startPlaceEntry.description;

			expect(result.places?.["start-place"]?.description).toBe(expectedDescription);
		},
	);

	it("should redact a flagged place while leaving an unflagged sibling unchanged", () => {
		expect.assertions(2);

		const plainPlace = {
			...startPlaceEntry,
			placeId: "1111",
		} as const satisfies ResolvedPlaceEntry;
		const result = applyRedaction({
			...baseConfig,
			places: {
				"plain-place": plainPlace,
				"secret-place": { ...startPlaceEntry, redacted: true },
			},
		});

		expect(result.places?.["plain-place"]).toStrictEqual(plainPlace);
		expect(result.places?.["secret-place"]?.description).toBe(REDACTED_DESCRIPTION);
	});

	it("should replace name, description, icon, and price with placeholders when a product redacted is true", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			products: { "gem-pack": { ...gemPackEntry, redacted: true } },
		});

		expect(result.products?.["gem-pack"]).toStrictEqual({
			name: defaultRedactedProductName("gem-pack"),
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			price: REDACTED_PRICE,
			redacted: true,
		});
	});

	it("should preserve an off-sale product as off-sale when redacted is true", () => {
		expect.assertions(1);

		const offSale = {
			name: "Coming Soon Pack",
			description: "Reveal at launch.",
			icon: { "en-us": "assets/soon.png" },
		} as const satisfies DeveloperProductEntry;

		const result = applyRedaction({
			...baseConfig,
			products: { "soon-pack": { ...offSale, redacted: true } },
		});

		expect(result.products?.["soon-pack"]).toStrictEqual({
			name: defaultRedactedProductName("soon-pack"),
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			redacted: true,
		});
	});

	it("should substitute the price override on a redacted product while leaving other fields at defaults", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			products: { "gem-pack": { ...gemPackEntry, redacted: { price: 500 } } },
		});

		expect(result.products?.["gem-pack"]).toStrictEqual({
			name: defaultRedactedProductName("gem-pack"),
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			price: 500,
			redacted: { price: 500 },
		});
	});

	it("should honour a price override of 0 on a redacted product without falling back to the default", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			products: { "gem-pack": { ...gemPackEntry, redacted: { price: 0 } } },
		});

		expect(result.products?.["gem-pack"]?.price).toBe(0);
	});

	it("should ignore a price override on a redacted product that is off-sale", () => {
		expect.assertions(1);

		const offSale = {
			name: "Coming Soon Pack",
			description: "Reveal at launch.",
			icon: { "en-us": "assets/soon.png" },
		} as const satisfies DeveloperProductEntry;

		const result = applyRedaction({
			...baseConfig,
			products: { "soon-pack": { ...offSale, redacted: { price: 500 } } },
		});

		expect(result.products?.["soon-pack"]).not.toHaveProperty("price");
	});

	it("should give two redacted products distinct default names so a Roblox-side uniqueness check sees no collision", () => {
		expect.assertions(2);

		const result = applyRedaction({
			...baseConfig,
			products: {
				"gem-pack": { ...gemPackEntry, redacted: true },
				"gold-pack": { ...gemPackEntry, redacted: true },
			},
		});

		const gemName = result.products?.["gem-pack"]?.name;
		const goldName = result.products?.["gold-pack"]?.name;
		assert(gemName !== undefined);
		assert(goldName !== undefined);

		expect(gemName).not.toBe(goldName);
		expect(
			[gemName, goldName].every((name) => name.startsWith(REDACTED_PRODUCT_NAME)),
		).toBeTrue();
	});

	it("should assign the placeholder icon to a redacted product even when the source entry declares no icon", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			products: {
				"plain-pack": {
					name: "Plain Pack",
					description: "Pack without an icon.",
					redacted: true,
				},
			},
		});

		expect(result.products?.["plain-pack"]?.icon).toStrictEqual({
			"en-us": REDACTED_ICON_PATH,
		});
	});

	it("should leave a product unchanged when redacted is false", () => {
		expect.assertions(1);

		const entry = { ...gemPackEntry, redacted: false } as const satisfies DeveloperProductEntry;
		const result = applyRedaction({
			...baseConfig,
			products: { "gem-pack": entry },
		});

		expect(result.products?.["gem-pack"]).toStrictEqual(entry);
	});

	it("should leave a product unchanged when redacted is omitted", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			products: { "gem-pack": gemPackEntry },
		});

		expect(result.products?.["gem-pack"]).toStrictEqual(gemPackEntry);
	});

	it("should not mutate the input config when redacting a product", () => {
		expect.assertions(2);

		const products = { "gem-pack": { ...gemPackEntry, redacted: true } };
		const input = { ...baseConfig, products } as const satisfies ResolvedConfig;

		const result = applyRedaction(input);

		expect(input.products["gem-pack"]).toStrictEqual({ ...gemPackEntry, redacted: true });
		expect(result.products?.["gem-pack"]).not.toBe(input.products["gem-pack"]);
	});

	it.for([
		{
			caseName: "no flags set",
			entryRedacted: undefined,
			envRedacted: undefined,
			expectRedacted: false,
		},
		{
			caseName: "env-level true, no resource flag",
			entryRedacted: undefined,
			envRedacted: true,
			expectRedacted: true,
		},
		{
			caseName: "env-level false, no resource flag",
			entryRedacted: undefined,
			envRedacted: false,
			expectRedacted: false,
		},
		{
			caseName: "resource false carves out env-level true",
			entryRedacted: false,
			envRedacted: true,
			expectRedacted: false,
		},
		{
			caseName: "resource true redacts despite env-level false",
			entryRedacted: true,
			envRedacted: false,
			expectRedacted: true,
		},
	] as const)(
		"should redact a product according to overlay > root > env precedence ($caseName)",
		({ entryRedacted, envRedacted, expectRedacted }) => {
			expect.assertions(1);

			const productEntry = (
				entryRedacted === undefined
					? gemPackEntry
					: { ...gemPackEntry, redacted: entryRedacted }
			) satisfies DeveloperProductEntry;
			const result = applyRedaction(
				{ ...baseConfig, products: { "gem-pack": productEntry } },
				envRedacted,
			);
			const expectedName = expectRedacted
				? defaultRedactedProductName("gem-pack")
				: gemPackEntry.name;

			expect(result.products?.["gem-pack"]?.name).toBe(expectedName);
		},
	);

	it("should substitute only the supplied product override fields and fall back to defaults for the rest", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			products: {
				"gem-pack": { ...gemPackEntry, redacted: { name: "Closed Beta Pack" } },
			},
		});

		expect(result.products?.["gem-pack"]).toStrictEqual({
			name: "Closed Beta Pack",
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			price: REDACTED_PRICE,
			redacted: { name: "Closed Beta Pack" },
		});
	});

	it("should substitute every product field when the override object supplies name, description, and icon", () => {
		expect.assertions(1);

		const override = {
			name: "Beta Pack",
			description: "Beta description",
			icon: { "en-us": "assets/beta.png" },
		};

		const result = applyRedaction({
			...baseConfig,
			products: { "gem-pack": { ...gemPackEntry, redacted: override } },
		});

		expect(result.products?.["gem-pack"]).toStrictEqual({
			name: "Beta Pack",
			description: "Beta description",
			icon: { "en-us": "assets/beta.png" },
			price: REDACTED_PRICE,
			redacted: override,
		});
	});

	it("should substitute the product icon override path while leaving non-icon fields at defaults", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			products: {
				"gem-pack": {
					...gemPackEntry,
					redacted: { icon: { "en-us": "assets/override-icon.png" } },
				},
			},
		});

		expect(result.products?.["gem-pack"]).toStrictEqual({
			name: defaultRedactedProductName("gem-pack"),
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": "assets/override-icon.png" },
			price: REDACTED_PRICE,
			redacted: { icon: { "en-us": "assets/override-icon.png" } },
		});
	});
});

describe(collectRedactionAnnotations, () => {
	it("should return an empty array when no passes collection is declared", () => {
		expect.assertions(1);
		expect(collectRedactionAnnotations(baseConfig)).toStrictEqual([]);
	});

	it("should return an empty array when no pass has redacted set to true", () => {
		expect.assertions(1);

		const result = collectRedactionAnnotations({
			...baseConfig,
			passes: {
				"opt-out-pass": { ...vipEntry, redacted: false },
				"plain-pass": vipEntry,
			},
		});

		expect(result).toStrictEqual([]);
	});

	it("should emit one gamePass annotation per pass flagged redacted true with hasRealValueEdits false when the author already typed placeholder values literally", () => {
		expect.assertions(1);

		const placeholderEntry: GamePassEntry = {
			name: REDACTED_PASS_NAME,
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			redacted: true,
		};

		const result = collectRedactionAnnotations({
			...baseConfig,
			passes: {
				"elite-pass": placeholderEntry,
				"plain-pass": vipEntry,
				"vip-pass": placeholderEntry,
			},
		});

		expect(result).toIncludeSameMembers([
			{ key: "vip-pass", hasRealValueEdits: false, kind: "gamePass" },
			{ key: "elite-pass", hasRealValueEdits: false, kind: "gamePass" },
		]);
	});

	it.for<{ entry: GamePassEntry; label: string }>([
		{
			entry: {
				name: "Real Name",
				description: REDACTED_DESCRIPTION,
				icon: { "en-us": REDACTED_ICON_PATH },
				redacted: true,
			},
			label: "name",
		},
		{
			entry: {
				name: REDACTED_PASS_NAME,
				description: "Real description.",
				icon: { "en-us": REDACTED_ICON_PATH },
				redacted: true,
			},
			label: "description",
		},
		{
			entry: {
				name: REDACTED_PASS_NAME,
				description: REDACTED_DESCRIPTION,
				icon: { "en-us": "assets/real.png" },
				redacted: true,
			},
			label: "icon",
		},
		{
			entry: {
				name: REDACTED_PASS_NAME,
				description: REDACTED_DESCRIPTION,
				icon: { "en-us": REDACTED_ICON_PATH },
				price: 500,
				redacted: true,
			},
			label: "price",
		},
	])(
		"should set hasRealValueEdits true when only the real $label diverges from the placeholder default",
		({ entry }) => {
			expect.assertions(1);

			const result = collectRedactionAnnotations({
				...baseConfig,
				passes: { "vip-pass": entry },
			});

			expect(result).toStrictEqual([
				{ key: "vip-pass", hasRealValueEdits: true, kind: "gamePass" },
			]);
		},
	);

	it("should return an empty array when no product has redacted set to true", () => {
		expect.assertions(1);

		const result = collectRedactionAnnotations({
			...baseConfig,
			products: {
				"opt-out-pack": { ...gemPackEntry, redacted: false },
				"plain-pack": gemPackEntry,
			},
		});

		expect(result).toStrictEqual([]);
	});

	it("should emit one developerProduct annotation per product flagged redacted true with hasRealValueEdits false when the author already typed placeholder values literally", () => {
		expect.assertions(1);

		const placeholderEntry: DeveloperProductEntry = {
			name: REDACTED_PRODUCT_NAME,
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			redacted: true,
		};

		const result = collectRedactionAnnotations({
			...baseConfig,
			products: {
				"elite-pack": placeholderEntry,
				"gem-pack": placeholderEntry,
				"plain-pack": gemPackEntry,
			},
		});

		expect(result).toIncludeSameMembers([
			{ key: "gem-pack", hasRealValueEdits: false, kind: "developerProduct" },
			{ key: "elite-pack", hasRealValueEdits: false, kind: "developerProduct" },
		]);
	});

	it("should set hasRealValueEdits false when a redacted product carries no icon at all", () => {
		expect.assertions(1);

		const result = collectRedactionAnnotations({
			...baseConfig,
			products: {
				"plain-pack": {
					name: REDACTED_PRODUCT_NAME,
					description: REDACTED_DESCRIPTION,
					redacted: true,
				},
			},
		});

		expect(result).toStrictEqual([
			{ key: "plain-pack", hasRealValueEdits: false, kind: "developerProduct" },
		]);
	});

	it.for<{ entry: DeveloperProductEntry; label: string }>([
		{
			entry: {
				name: "Real Pack",
				description: REDACTED_DESCRIPTION,
				icon: { "en-us": REDACTED_ICON_PATH },
				redacted: true,
			},
			label: "name",
		},
		{
			entry: {
				name: REDACTED_PRODUCT_NAME,
				description: "Real description.",
				icon: { "en-us": REDACTED_ICON_PATH },
				redacted: true,
			},
			label: "description",
		},
		{
			entry: {
				name: REDACTED_PRODUCT_NAME,
				description: REDACTED_DESCRIPTION,
				icon: { "en-us": "assets/real.png" },
				redacted: true,
			},
			label: "icon",
		},
		{
			entry: {
				name: REDACTED_PRODUCT_NAME,
				description: REDACTED_DESCRIPTION,
				icon: { "en-us": REDACTED_ICON_PATH },
				price: 250,
				redacted: true,
			},
			label: "price",
		},
	])(
		"should set hasRealValueEdits true when only the real product $label diverges from the placeholder default",
		({ entry }) => {
			expect.assertions(1);

			const result = collectRedactionAnnotations({
				...baseConfig,
				products: { "gem-pack": entry },
			});

			expect(result).toStrictEqual([
				{ key: "gem-pack", hasRealValueEdits: true, kind: "developerProduct" },
			]);
		},
	);

	it.for<{ entry: GamePassEntry; label: string }>([
		{
			entry: {
				name: REDACTED_PASS_NAME,
				description: REDACTED_DESCRIPTION,
				icon: { "en-us": REDACTED_ICON_PATH },
				price: REDACTED_PRICE,
				redacted: true,
			},
			label: "price matches the placeholder default",
		},
		{
			entry: {
				name: REDACTED_PASS_NAME,
				description: REDACTED_DESCRIPTION,
				icon: { "en-us": REDACTED_ICON_PATH },
				redacted: true,
			},
			label: "the pass is off-sale",
		},
	])("should set hasRealValueEdits false on a redacted pass when $label", ({ entry }) => {
		expect.assertions(1);

		const result = collectRedactionAnnotations({
			...baseConfig,
			passes: { "vip-pass": entry },
		});

		expect(result).toStrictEqual([
			{ key: "vip-pass", hasRealValueEdits: false, kind: "gamePass" },
		]);
	});

	it.for<{ entry: DeveloperProductEntry; label: string }>([
		{
			entry: {
				name: REDACTED_PRODUCT_NAME,
				description: REDACTED_DESCRIPTION,
				icon: { "en-us": REDACTED_ICON_PATH },
				price: REDACTED_PRICE,
				redacted: true,
			},
			label: "price matches the placeholder default",
		},
		{
			entry: {
				name: REDACTED_PRODUCT_NAME,
				description: REDACTED_DESCRIPTION,
				icon: { "en-us": REDACTED_ICON_PATH },
				redacted: true,
			},
			label: "the product is off-sale",
		},
	])("should set hasRealValueEdits false on a redacted product when $label", ({ entry }) => {
		expect.assertions(1);

		const result = collectRedactionAnnotations({
			...baseConfig,
			products: { "gem-pack": entry },
		});

		expect(result).toStrictEqual([
			{ key: "gem-pack", hasRealValueEdits: false, kind: "developerProduct" },
		]);
	});

	it("should emit annotations for both passes and products when each kind declares a redacted entry", () => {
		expect.assertions(1);

		const result = collectRedactionAnnotations({
			...baseConfig,
			passes: { "vip-pass": { ...vipEntry, redacted: true } },
			products: { "gem-pack": { ...gemPackEntry, redacted: true } },
		});

		expect(result).toIncludeSameMembers([
			{ key: "vip-pass", hasRealValueEdits: true, kind: "gamePass" },
			{ key: "gem-pack", hasRealValueEdits: true, kind: "developerProduct" },
		]);
	});

	it("should set hasRealValueEdits false when the author types the suffixed default name verbatim", () => {
		expect.assertions(1);

		const result = collectRedactionAnnotations({
			...baseConfig,
			products: {
				"gem-pack": {
					name: defaultRedactedProductName("gem-pack"),
					description: REDACTED_DESCRIPTION,
					icon: { "en-us": REDACTED_ICON_PATH },
					redacted: true,
				},
			},
		});

		expect(result).toStrictEqual([
			{ key: "gem-pack", hasRealValueEdits: false, kind: "developerProduct" },
		]);
	});

	it("should set hasRealValueEdits true when the name only shares the placeholder prefix (e.g. Hidden Product Deluxe)", () => {
		expect.assertions(1);

		const result = collectRedactionAnnotations({
			...baseConfig,
			products: {
				"gem-pack": {
					name: `${REDACTED_PRODUCT_NAME} Deluxe`,
					description: REDACTED_DESCRIPTION,
					icon: { "en-us": REDACTED_ICON_PATH },
					redacted: true,
				},
			},
		});

		expect(result).toStrictEqual([
			{ key: "gem-pack", hasRealValueEdits: true, kind: "developerProduct" },
		]);
	});

	it("should set hasRealValueEdits true when the name's suffix does not match this key's hash", () => {
		expect.assertions(1);

		const result = collectRedactionAnnotations({
			...baseConfig,
			products: {
				"gem-pack": {
					name: defaultRedactedProductName("gold-pack"),
					description: REDACTED_DESCRIPTION,
					icon: { "en-us": REDACTED_ICON_PATH },
					redacted: true,
				},
			},
		});

		expect(result).toStrictEqual([
			{ key: "gem-pack", hasRealValueEdits: true, kind: "developerProduct" },
		]);
	});
});

describe(redactedNameSuffix, () => {
	it("should return six lowercase hex characters", () => {
		expect.assertions(1);
		expect(redactedNameSuffix("bp-1")).toMatch(/^[0-9a-f]{6}$/);
	});

	it("should be deterministic for the same input", () => {
		expect.assertions(1);
		expect(redactedNameSuffix("bp-1")).toBe(redactedNameSuffix("bp-1"));
	});

	it("should differ for two distinct keys to make Roblox-side name collisions unlikely", () => {
		expect.assertions(1);
		expect(redactedNameSuffix("bp-1")).not.toBe(redactedNameSuffix("bp-2"));
	});

	it("should match a known SHA-256 prefix for a fixed key so the wire-visible value is pinned", () => {
		expect.assertions(1);
		expect(redactedNameSuffix("bp-1")).toBe("f5df4b");
	});
});

describe(defaultRedactedProductName, () => {
	it("should combine the placeholder prefix with the key's suffix separated by a space", () => {
		expect.assertions(1);
		expect(defaultRedactedProductName("bp-1")).toBe(
			`${REDACTED_PRODUCT_NAME} ${redactedNameSuffix("bp-1")}`,
		);
	});

	it("should not contain a hash sign or the word Redacted so Roblox's text-moderation filter does not collapse the name to ########", () => {
		expect.assertions(2);

		const name = defaultRedactedProductName("bp-1");

		expect(name).not.toInclude("#");
		expect(name).not.toInclude("Redacted");
	});
});
