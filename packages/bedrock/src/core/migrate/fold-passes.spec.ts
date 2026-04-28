import { assert, describe, expect, it } from "vitest";

import { asResourceKey, asSha256Hex } from "../../types/ids.ts";
import { foldPasses } from "./fold-passes.ts";
import type { MantleResource } from "./types.ts";

const SAMPLE_HASH = "86890ed405cabad0fcdabf52225d528981790fa551e915c070348761c28373c1";

interface PassFixture {
	readonly inputs: unknown;
	readonly outputs: unknown;
}

function pass(key: string, payload: PassFixture): MantleResource {
	return {
		key,
		dependencies: [],
		inputs: payload.inputs,
		kind: "pass",
		outputs: payload.outputs,
	};
}

function onSaleInputs(): Record<string, unknown> {
	return {
		name: "Example Pass",
		description: "This is an example pass.",
		iconFileHash: SAMPLE_HASH,
		iconFilePath: "assets/marketing/example-icon.png",
		price: 5,
	};
}

function passOutputs(): Record<string, unknown> {
	return { assetId: 838509486, iconAssetId: 18109205439 };
}

function fixture(inputs?: unknown, outputs?: unknown): PassFixture {
	return {
		inputs: inputs === undefined ? onSaleInputs() : inputs,
		outputs: outputs === undefined ? passOutputs() : outputs,
	};
}

describe(foldPasses, () => {
	it("should map pass.inputs.{name, description, iconFilePath} to a GamePassEntry with a locale-keyed icon", () => {
		expect.assertions(1);

		const result = foldPasses([pass("1-example", fixture())]);
		const [entry] = result.passes;
		assert(entry !== undefined);

		expect(entry.entry).toStrictEqual({
			name: "Example Pass",
			description: "This is an example pass.",
			icon: { "en-us": "assets/marketing/example-icon.png" },
			price: 5,
		});
	});

	it("should carry the GamePassOutputs derived from pass.outputs", () => {
		expect.assertions(1);

		const result = foldPasses([pass("1-example", fixture())]);
		const [entry] = result.passes;
		assert(entry !== undefined);

		expect(entry.outputs).toStrictEqual({
			assetId: "838509486",
			iconAssetIds: { "en-us": "18109205439" },
		});
	});

	it("should expose the resource key as a branded ResourceKey", () => {
		expect.assertions(1);

		const result = foldPasses([pass("1-example", fixture())]);
		const [entry] = result.passes;
		assert(entry !== undefined);

		expect(entry.key).toBe(asResourceKey("1-example"));
	});

	it("should preserve the Mantle-recorded iconFileHash under the locale key for downstream use", () => {
		expect.assertions(1);

		const result = foldPasses([pass("1-example", fixture())]);
		const [entry] = result.passes;
		assert(entry !== undefined);

		expect(entry.mantleIconFileHashes).toStrictEqual({ "en-us": asSha256Hex(SAMPLE_HASH) });
	});

	it("should expose the per-resource mantlePath rooted at pass_<k>", () => {
		expect.assertions(1);

		const result = foldPasses([pass("1-example", fixture())]);
		const [entry] = result.passes;
		assert(entry !== undefined);

		expect(entry.mantlePath).toBe("pass_1-example");
	});

	it("should set price to undefined when the inputs do not declare one (off-sale pass)", () => {
		expect.assertions(1);

		const inputs = onSaleInputs();
		delete inputs["price"];

		const result = foldPasses([pass("1-example", fixture(inputs))]);
		const [entry] = result.passes;
		assert(entry !== undefined);

		expect(entry.entry.price).toBeUndefined();
	});

	it("should preserve non-ASCII characters in name and description", () => {
		expect.assertions(2);

		const inputs = onSaleInputs();
		inputs["name"] = "プレミアム パス";
		inputs["description"] = "高品質パークが付属";

		const result = foldPasses([pass("1-example", fixture(inputs))]);
		const [entry] = result.passes;
		assert(entry !== undefined);

		expect(entry.entry.name).toBe("プレミアム パス");
		expect(entry.entry.description).toBe("高品質パークが付属");
	});

	it("should accept string-formatted ids in the outputs", () => {
		expect.assertions(2);

		const result = foldPasses([
			pass(
				"1-example",
				fixture(undefined, { assetId: "838509486", iconAssetId: "18109205439" }),
			),
		]);
		const [entry] = result.passes;
		assert(entry !== undefined);

		expect(entry.outputs.assetId).toBe("838509486");
		expect(entry.outputs.iconAssetIds["en-us"]).toBe("18109205439");
	});

	it("should ignore Mantle resources whose kind is not pass even when their payload is pass-shaped", () => {
		expect.assertions(1);

		const result = foldPasses([
			{
				key: "1-spurious",
				dependencies: [],
				inputs: onSaleInputs(),
				kind: "developerProduct",
				outputs: passOutputs(),
			},
		]);

		expect(result.passes).toStrictEqual([]);
	});

	it("should yield multiple entries when the environment declares multiple passes", () => {
		expect.assertions(1);

		const result = foldPasses([
			pass("1-vip", fixture()),
			pass("2-gold", fixture({ ...onSaleInputs(), name: "Gold Pass" })),
		]);

		expect(result.passes.map((entry) => entry.key)).toStrictEqual([
			asResourceKey("1-vip"),
			asResourceKey("2-gold"),
		]);
	});

	it("should emit no warnings for well-formed pass resources", () => {
		expect.assertions(1);

		const result = foldPasses([pass("1-example", fixture())]);

		expect(result.warnings).toStrictEqual([]);
	});

	it("should drop a pass whose inputs payload is not an object", () => {
		expect.assertions(1);

		// eslint-disable-next-line unicorn/no-null -- exercising the null branch of the defensive guard
		const result = foldPasses([pass("1-example", fixture(null))]);

		expect(result.passes).toStrictEqual([]);
	});

	it("should drop a pass whose outputs payload is not an object", () => {
		expect.assertions(1);

		const result = foldPasses([pass("1-example", fixture(undefined, "pass"))]);

		expect(result.passes).toStrictEqual([]);
	});

	it("should drop a pass whose required input string fields are missing", () => {
		expect.assertions(3);

		const noName = onSaleInputs();
		delete noName["name"];
		const noDescription = onSaleInputs();
		delete noDescription["description"];
		const noIconFilePath = onSaleInputs();
		delete noIconFilePath["iconFilePath"];

		expect(foldPasses([pass("1-example", fixture(noName))]).passes).toStrictEqual([]);
		expect(foldPasses([pass("1-example", fixture(noDescription))]).passes).toStrictEqual([]);
		expect(foldPasses([pass("1-example", fixture(noIconFilePath))]).passes).toStrictEqual([]);
	});

	it("should drop a pass whose outputs lack assetId or iconAssetId", () => {
		expect.assertions(2);

		expect(
			foldPasses([pass("1-example", fixture(undefined, { iconAssetId: 1 }))]).passes,
		).toStrictEqual([]);
		expect(
			foldPasses([pass("1-example", fixture(undefined, { assetId: 1 }))]).passes,
		).toStrictEqual([]);
	});

	it("should drop a pass whose Mantle-recorded iconFileHash is not a Sha256Hex", () => {
		expect.assertions(2);

		const inputs = onSaleInputs();
		inputs["iconFileHash"] = "not-a-real-hash";

		const noHash = onSaleInputs();
		delete noHash["iconFileHash"];

		expect(foldPasses([pass("1-example", fixture(inputs))]).passes).toStrictEqual([]);
		expect(foldPasses([pass("1-example", fixture(noHash))]).passes).toStrictEqual([]);
	});

	it("should treat a declared price of undefined (Mantle `price: ~`) as off-sale", () => {
		expect.assertions(1);

		const inputs = onSaleInputs();
		inputs["price"] = undefined;

		const result = foldPasses([pass("1-example", fixture(inputs))]);
		const [entry] = result.passes;
		assert(entry !== undefined);

		expect(entry.entry.price).toBeUndefined();
	});

	it("should drop a non-numeric price as off-sale rather than letting it propagate", () => {
		expect.assertions(1);

		const inputs = onSaleInputs();
		inputs["price"] = "five";

		const result = foldPasses([pass("1-example", fixture(inputs))]);
		const [entry] = result.passes;
		assert(entry !== undefined);

		expect(entry.entry.price).toBeUndefined();
	});

	it("should drop a pass whose inputs is array-typed", () => {
		expect.assertions(1);

		const result = foldPasses([pass("1-example", fixture([]))]);

		expect(result.passes).toStrictEqual([]);
	});
});
