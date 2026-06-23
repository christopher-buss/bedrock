import { describe, expect, it } from "vitest";

import {
	collectRealDisplay,
	REDACTED_DESCRIPTION,
	REDACTED_PASS_NAME,
	REDACTED_PRICE,
} from "./redact-resources.ts";
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

describe(collectRealDisplay, () => {
	it("should record real name, description, and price for a redacted game pass", () => {
		expect.assertions(1);

		const result = collectRealDisplay({
			...baseConfig,
			passes: { "vip-pass": { ...vipEntry, redacted: true } },
		});

		expect(result["gamePass:vip-pass"]).toStrictEqual({
			name: "VIP Pass",
			description: "Grants VIP perks.",
			price: 500,
		});
	});

	it("should record real name, description, and price for a redacted developer product", () => {
		expect.assertions(1);

		const result = collectRealDisplay({
			...baseConfig,
			products: { "gem-pack": { ...gemPackEntry, redacted: true } },
		});

		expect(result["developerProduct:gem-pack"]).toStrictEqual({
			name: "Gem Pack",
			description: "Stocks the player up with 1,000 premium gems.",
			price: 100,
		});
	});

	it("should omit a resource that is not redacted", () => {
		expect.assertions(1);

		const result = collectRealDisplay({
			...baseConfig,
			passes: { "vip-pass": vipEntry },
		});

		expect(result).toStrictEqual({});
	});

	it("should omit the price field for a redacted off-sale game pass", () => {
		expect.assertions(1);

		const result = collectRealDisplay({
			...baseConfig,
			passes: { "free-pass": { ...vipEntry, price: undefined, redacted: true } },
		});

		expect(result["gamePass:free-pass"]).toStrictEqual({
			name: "VIP Pass",
			description: "Grants VIP perks.",
		});
	});

	it("should omit a field whose override equals the real value", () => {
		expect.assertions(1);

		const result = collectRealDisplay({
			...baseConfig,
			passes: { "vip-pass": { ...vipEntry, redacted: { name: "VIP Pass" } } },
		});

		expect(result["gamePass:vip-pass"]).toStrictEqual({
			description: "Grants VIP perks.",
			price: 500,
		});
	});

	it("should record the real description but not the preserved display name for a redacted place", () => {
		expect.assertions(1);

		const result = collectRealDisplay({
			...baseConfig,
			places: { start: { ...startPlaceEntry, redacted: true } },
		});

		expect(result["place:start"]).toStrictEqual({
			description: "The lobby place.",
		});
	});

	it("should record the real display name when a redacted place overrides it", () => {
		expect.assertions(1);

		const result = collectRealDisplay({
			...baseConfig,
			places: { start: { ...startPlaceEntry, redacted: { displayName: "Hidden Lobby" } } },
		});

		expect(result["place:start"]).toStrictEqual({
			description: "The lobby place.",
			displayName: "Start Place",
		});
	});

	it("should omit a redacted pass whose real values already equal every placeholder", () => {
		expect.assertions(1);

		const result = collectRealDisplay({
			...baseConfig,
			passes: {
				"placeholder-pass": {
					name: REDACTED_PASS_NAME,
					description: REDACTED_DESCRIPTION,
					icon: { "en-us": "assets/vip.png" },
					price: REDACTED_PRICE,
					redacted: true,
				},
			},
		});

		expect(result).toStrictEqual({});
	});

	it("should omit a redacted place whose description already equals the placeholder", () => {
		expect.assertions(1);

		const result = collectRealDisplay({
			...baseConfig,
			places: {
				start: { ...startPlaceEntry, description: REDACTED_DESCRIPTION, redacted: true },
			},
		});

		expect(result).toStrictEqual({});
	});

	it("should honor an environment-level redaction toggle", () => {
		expect.assertions(1);

		const result = collectRealDisplay(
			{
				...baseConfig,
				passes: { "vip-pass": vipEntry },
			},
			{ envLevel: true },
		);

		expect(result["gamePass:vip-pass"]).toStrictEqual({
			name: "VIP Pass",
			description: "Grants VIP perks.",
			price: 500,
		});
	});
});
