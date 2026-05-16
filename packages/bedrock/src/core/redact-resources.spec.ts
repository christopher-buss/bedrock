import { describe, expect, it } from "vitest";

import {
	applyRedaction,
	collectRedactionAnnotations,
	REDACTED_DESCRIPTION,
	REDACTED_PASS_NAME,
	REDACTED_PRODUCT_NAME,
} from "./redact-resources.ts";
import { REDACTED_ICON_PATH } from "./redacted-icon.ts";
import type { DeveloperProductEntry, GamePassEntry, ResolvedConfig } from "./schema.ts";

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

describe(applyRedaction, () => {
	it("should replace name, description, and icon with placeholders when redacted is true", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			passes: { "vip-pass": { ...vipEntry, redacted: true } },
		});

		expect(result.passes?.["vip-pass"]).toStrictEqual({
			name: REDACTED_PASS_NAME,
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			price: 500,
			redacted: true,
		});
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

	it("should pass through products, places, and universe collections verbatim", () => {
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
			price: 500,
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
			price: 500,
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
			price: 500,
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

	it("should replace name, description, and icon with placeholders when a product redacted is true", () => {
		expect.assertions(1);

		const result = applyRedaction({
			...baseConfig,
			products: { "gem-pack": { ...gemPackEntry, redacted: true } },
		});

		expect(result.products?.["gem-pack"]).toStrictEqual({
			name: REDACTED_PRODUCT_NAME,
			description: REDACTED_DESCRIPTION,
			icon: { "en-us": REDACTED_ICON_PATH },
			price: 100,
			redacted: true,
		});
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
			const expectedName = expectRedacted ? REDACTED_PRODUCT_NAME : gemPackEntry.name;

			expect(result.products?.["gem-pack"]?.name).toBe(expectedName);
		},
	);
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
});
