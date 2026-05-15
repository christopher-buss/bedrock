import { describe, expect, it } from "vitest";

import {
	applyRedaction,
	collectRedactionAnnotations,
	REDACTED_DESCRIPTION,
	REDACTED_PASS_NAME,
} from "./redact-resources.ts";
import { REDACTED_ICON_PATH } from "./redacted-icon.ts";
import type { GamePassEntry, ResolvedConfig } from "./schema.ts";

const baseConfig: ResolvedConfig = {
	environments: { production: {} },
};

const vipEntry = {
	name: "VIP Pass",
	description: "Grants VIP perks.",
	icon: { "en-us": "assets/vip.png" },
	price: 500,
} as const satisfies GamePassEntry;

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
