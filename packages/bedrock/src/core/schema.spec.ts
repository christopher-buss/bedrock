import { PLATFORM_FLAG_ROWS } from "#tests/helpers/resources";
import { assert, describe, expect, it } from "vitest";

import { SOCIAL_LINK_FIELDS } from "./resources.ts";
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

	it("should accept a universe block declaring only universeId", () => {
		expect.assertions(2);

		const result = validateConfig({ universe: { universeId: "1234567890" } }, SOURCE);

		assert(result.success);

		expect(result.data.universe!.universeId).toBe("1234567890");
		expect(result.data.universe!.voiceChatEnabled).toBeUndefined();
	});

	it("should accept a universe block with voiceChatEnabled declared", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ universe: { universeId: "1234567890", voiceChatEnabled: true } },
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe!.voiceChatEnabled).toBeTrue();
	});

	it.for(PLATFORM_FLAG_ROWS)("should accept a universe block with %s declared", ([flag]) => {
		expect.assertions(1);

		const result = validateConfig(
			{ universe: { [flag]: false, universeId: "1234567890" } },
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe![flag]).toBeFalse();
	});

	it.for(PLATFORM_FLAG_ROWS)(
		"should default %s to undefined when the universe block omits it",
		([flag]) => {
			expect.assertions(1);

			const result = validateConfig({ universe: { universeId: "1234567890" } }, SOURCE);

			assert(result.success);

			expect(result.data.universe![flag]).toBeUndefined();
		},
	);

	it.for(PLATFORM_FLAG_ROWS)("should reject a non-boolean %s on a universe block", ([flag]) => {
		expect.assertions(1);

		const result = validateConfig(
			{ universe: { [flag]: "oops", universeId: "1234567890" } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", flag]);
	});

	it("should accept a universe block with every platform flag declared", () => {
		expect.assertions(5);

		const result = validateConfig(
			{
				universe: {
					consoleEnabled: false,
					desktopEnabled: true,
					mobileEnabled: false,
					tabletEnabled: true,
					universeId: "1234567890",
					vrEnabled: false,
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe!.desktopEnabled).toBeTrue();
		expect(result.data.universe!.mobileEnabled).toBeFalse();
		expect(result.data.universe!.tabletEnabled).toBeTrue();
		expect(result.data.universe!.consoleEnabled).toBeFalse();
		expect(result.data.universe!.vrEnabled).toBeFalse();
	});

	it("should reject a universe block missing universeId", () => {
		expect.assertions(1);

		const result = validateConfig({ universe: { voiceChatEnabled: true } }, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "universeId"]);
	});

	it.for([
		["trailing non-digits", "4711abc"],
		["leading non-digits", "abc4711"],
		["embedded non-digits", "47abc11"],
	] as const)("should reject a universe whose universeId has %s", ([, universeId]) => {
		expect.assertions(1);

		const result = validateConfig({ universe: { universeId } }, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "universeId"]);
	});

	it("should accept a universe block with all four optional managed fields declared", () => {
		expect.assertions(4);

		const result = validateConfig(
			{
				universe: {
					displayName: "Fun Universe",
					privateServerPriceRobux: 250,
					universeId: "1234567890",
					visibility: "public",
					voiceChatEnabled: true,
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.universe!.displayName).toBe("Fun Universe");
		expect(result.data.universe!.visibility).toBe("public");
		expect(result.data.universe!.privateServerPriceRobux).toBe(250);
		expect(result.data.universe!.voiceChatEnabled).toBeTrue();
	});

	it("should preserve key-presence when privateServerPriceRobux is declared as undefined", () => {
		expect.assertions(2);

		const result = validateConfig(
			{
				universe: {
					privateServerPriceRobux: undefined,
					universeId: "1234567890",
				},
			},
			SOURCE,
		);

		assert(result.success);

		expect("privateServerPriceRobux" in result.data.universe!).toBeTrue();
		expect(result.data.universe!.privateServerPriceRobux).toBeUndefined();
	});

	it("should omit privateServerPriceRobux when the user does not declare it", () => {
		expect.assertions(1);

		const result = validateConfig({ universe: { universeId: "1234567890" } }, SOURCE);

		assert(result.success);

		expect("privateServerPriceRobux" in result.data.universe!).toBeFalse();
	});

	it.for(["private", "public", "unspecified"] as const)(
		"should accept visibility value %s",
		(value) => {
			expect.assertions(1);

			const result = validateConfig(
				{ universe: { universeId: "1234567890", visibility: value } },
				SOURCE,
			);

			expect(result.success).toBeTrue();
		},
	);

	it("should reject a visibility value outside the three-member union", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ universe: { universeId: "1234567890", visibility: "internal" } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "visibility"]);
	});

	it("should reject a negative privateServerPriceRobux", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ universe: { privateServerPriceRobux: -1, universeId: "1234567890" } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "privateServerPriceRobux"]);
	});

	it("should reject a non-integer privateServerPriceRobux", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ universe: { privateServerPriceRobux: 12.5, universeId: "1234567890" } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "privateServerPriceRobux"]);
	});

	it("should reject an undeclared field on a universe block", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ universe: { unexpected: "nope", universeId: "1234567890" } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", "unexpected"]);
	});

	it.for(SOCIAL_LINK_FIELDS)(
		"should accept a universe block with %s declared as a SocialLink object",
		(field) => {
			expect.assertions(2);

			const result = validateConfig(
				{
					universe: {
						[field]: { title: "Join us", uri: "https://example.com/x" },
						universeId: "1234567890",
					},
				},
				SOURCE,
			);

			assert(result.success);

			expect(result.data.universe).toContainKey(field);
			expect(result.data.universe![field]).toStrictEqual({
				title: "Join us",
				uri: "https://example.com/x",
			});
		},
	);

	it.for(SOCIAL_LINK_FIELDS)(
		"should accept a universe block with %s declared as undefined and preserve the key",
		(field) => {
			expect.assertions(2);

			const result = validateConfig(
				{ universe: { [field]: undefined, universeId: "1234567890" } },
				SOURCE,
			);

			assert(result.success);

			expect(result.data.universe).toContainKey(field);
			expect(result.data.universe![field]).toBeUndefined();
		},
	);

	it.for(SOCIAL_LINK_FIELDS)(
		"should omit %s from validated data when the key is absent in the config",
		(field) => {
			expect.assertions(1);

			const result = validateConfig({ universe: { universeId: "1234567890" } }, SOURCE);

			assert(result.success);

			expect(result.data.universe).not.toContainKey(field);
		},
	);

	it.for(SOCIAL_LINK_FIELDS)(
		"should reject a %s that is missing uri and attribute the issue path to the uri field",
		(field) => {
			expect.assertions(1);

			const result = validateConfig(
				{
					universe: {
						[field]: { title: "Join us" },
						universeId: "1234567890",
					},
				},
				SOURCE,
			);

			assert(!result.success);
			assert(result.err.kind === "validationFailed");

			expect(result.err.issues[0]!.path).toStrictEqual(["universe", field, "uri"]);
		},
	);

	it.for(SOCIAL_LINK_FIELDS)("should reject an undeclared field inside a %s block", (field) => {
		expect.assertions(1);

		const result = validateConfig(
			{
				universe: {
					[field]: { extra: 1, title: "Join us", uri: "https://example.com/x" },
					universeId: "1234567890",
				},
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["universe", field, "extra"]);
	});

	it("should accept a universe block with all seven social links declared together", () => {
		expect.assertions(7);

		const entry: Record<string, unknown> = { universeId: "1234567890" };
		for (const field of SOCIAL_LINK_FIELDS) {
			entry[field] = { title: `t-${field}`, uri: `https://example.com/${field}` };
		}

		const result = validateConfig({ universe: entry }, SOURCE);
		assert(result.success);

		for (const field of SOCIAL_LINK_FIELDS) {
			expect(result.data.universe![field]).toStrictEqual({
				title: `t-${field}`,
				uri: `https://example.com/${field}`,
			});
		}
	});

	it("should accept environments[name].state with the same shape as root state", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					production: { state: { backend: "gist", gistId: "prod-gist" } },
				},
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(result.success);

		expect(result.data.environments?.["production"]?.state).toContainEntry([
			"gistId",
			"prod-gist",
		]);
	});

	it("should accept a config that declares only environments[name].state and no root state", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: {
					production: { state: { backend: "gist", gistId: "prod-gist" } },
					staging: { state: { backend: "gist", gistId: "staging-gist" } },
				},
			},
			SOURCE,
		);

		expect(result.success).toBeTrue();
	});

	it("should reject an environments key that does not match the ResourceKey pattern", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: { "bad name!": {} },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["environments", "bad name!"]);
	});

	it("should reject an undeclared field on an environments entry", () => {
		expect.assertions(1);

		const result = validateConfig(
			{
				environments: { production: { unexpected: 1 } },
				state: { backend: "gist", gistId: "root-gist" },
			},
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual([
			"environments",
			"production",
			"unexpected",
		]);
	});

	it("should accept a config whose root state declares backend gist with a gistId", () => {
		expect.assertions(2);

		const result = validateConfig(
			{ state: { backend: "gist", gistId: "abc123def456" } },
			SOURCE,
		);

		assert(result.success);

		expect(result.data.state).toContainEntry(["backend", "gist"]);
		expect(result.data.state).toContainEntry(["gistId", "abc123def456"]);
	});

	it("should reject a state block missing the backend field and attribute the issue path to backend", () => {
		expect.assertions(1);

		const result = validateConfig({ state: { gistId: "abc123" } }, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "backend"]);
	});

	it("should reject a gist state block whose gistId is the empty string", () => {
		expect.assertions(1);

		const result = validateConfig({ state: { backend: "gist", gistId: "" } }, SOURCE);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "gistId"]);
	});

	it("should accept a state block whose backend is an unrecognized string at the runtime layer", () => {
		expect.assertions(1);

		const result = validateConfig({ state: { backend: "future-backend" } }, SOURCE);

		expect(result.success).toBeTrue();
	});

	it("should reject an undeclared field on a state block", () => {
		expect.assertions(1);

		const result = validateConfig(
			{ state: { backend: "gist", gistId: "abc123", unexpected: "nope" } },
			SOURCE,
		);

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.path).toStrictEqual(["state", "unexpected"]);
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
