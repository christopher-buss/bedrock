import { assert, describe, expect, it } from "vitest";

import { validateConfig } from "./schema.ts";

const SOURCE = "bedrock.config.ts";

describe(validateConfig, () => {
	it("should accept an empty config", () => {
		expect.assertions(1);

		const result = validateConfig({}, SOURCE);

		assert(result.success);

		expect(result.data).toStrictEqual({});
	});

	it.for([
		["environments", { environments: { production: {} } }],
		["extends", { extends: "./base.config.ts" }],
		["universe", { universe: { name: "My Game" } }],
	] as const)("should accept the reserved %s key at the root", ([, input]) => {
		expect.assertions(1);

		const result = validateConfig(input, SOURCE);

		expect(result.success).toBeTrue();
	});

	it("should reject unknown top-level keys and point the issue path at the offending key", () => {
		expect.assertions(3);

		const result = validateConfig({ unexpected: {} }, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.sourceFile).toBe(SOURCE);
		expect(result.err.issues).toHaveLength(1);
		expect(result.err.issues[0]!.path).toStrictEqual(["unexpected"]);
	});

	it("should accept a passes collection with a valid game-pass entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						iconFilePath: "assets/vip.png",
						price: 500,
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.passes!["vip-pass"]!.price).toBe(500);
	});

	it("should default price to undefined when omitted on a passes entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				passes: {
					"free-pass": {
						name: "Free Pass",
						description: "Free pass.",
						iconFilePath: "assets/free.png",
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.passes!["free-pass"]!.price).toBeUndefined();
	});

	it("should reject a passes key that does not match the ResourceKey pattern and attribute the issue path to that key", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				passes: {
					"bad key!": {
						name: "Bad",
						description: "Invalid key.",
						iconFilePath: "assets/bad.png",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["passes", "bad key!"]);
	});

	it("should reject a passes entry missing a required field and attribute the issue path to that field", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				passes: {
					"vip-pass": {
						name: "VIP",
						description: "Missing iconFilePath.",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["passes", "vip-pass", "iconFilePath"]);
	});

	it("should reject a wrongly-typed field and attribute the issue path to that field", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				passes: {
					"vip-pass": {
						name: "VIP",
						description: "Bad price.",
						iconFilePath: "assets/vip.png",
						price: "oops",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["passes", "vip-pass", "price"]);
	});

	it("should accept a places collection with a valid place entry", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				places: {
					"start-place": {
						filePath: "places/start.rbxl",
						placeId: "4711",
					},
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.places!["start-place"]!.placeId).toBe("4711");
		expect(result.data.places!["start-place"]!.filePath).toBe("places/start.rbxl");
	});

	it("should reject a place entry missing placeId and attribute the issue path to that field", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				places: {
					"start-place": { filePath: "places/start.rbxl" },
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["places", "start-place", "placeId"]);
	});

	it("should reject an undeclared field on a place entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				places: {
					"start-place": {
						filePath: "places/start.rbxl",
						placeId: "4711",
						unexpected: "nope",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["places", "start-place", "unexpected"]);
	});

	it.for([
		["trailing non-digits", "4711abc"],
		["leading non-digits", "abc4711"],
		["embedded non-digits", "47abc11"],
	] as const)("should reject a place entry whose placeId has %s", ([, placeId]) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				places: {
					"start-place": { filePath: "places/start.rbxl", placeId },
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["places", "start-place", "placeId"]);
	});

	it("should reject a places key that does not match the ResourceKey pattern", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				places: {
					"bad key!": { filePath: "places/start.rbxl", placeId: "4711" },
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["places", "bad key!"]);
	});

	it("should accumulate every validation issue with its own attributed field path", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				passes: {
					"vip-pass": {
						name: 42,
						description: "Two bad fields.",
						iconFilePath: "assets/vip.png",
						price: "oops",
					},
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues.map((issue) => issue.path)).toStrictEqual([
			["passes", "vip-pass", "name"],
			["passes", "vip-pass", "price"],
		]);
	});
});
