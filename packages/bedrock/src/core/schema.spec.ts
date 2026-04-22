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
		["experience", { experience: { name: "My Game" } }],
		["environments", { environments: { production: {} } }],
		["extends", { extends: "./base.config.ts" }],
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
});
