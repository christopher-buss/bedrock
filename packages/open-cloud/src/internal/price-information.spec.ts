import { describe, expect, it } from "vitest";

import {
	copyPriceInformation,
	isPriceInformationLike,
	type PriceInformationLike,
} from "./price-information.ts";

type TestFeature = "alpha" | "beta";

function isTestFeature(value: unknown): value is TestFeature {
	return value === "alpha" || value === "beta";
}

describe(isPriceInformationLike, () => {
	it("should accept a record with undefined default price and an empty feature list", () => {
		expect.assertions(1);

		expect(
			isPriceInformationLike(
				{ defaultPriceInRobux: undefined, enabledFeatures: [] },
				isTestFeature,
			),
		).toBeTrue();
	});

	it("should accept a record whose features all pass the injected guard", () => {
		expect.assertions(1);

		expect(
			isPriceInformationLike(
				{ defaultPriceInRobux: 100, enabledFeatures: ["alpha", "beta"] },
				isTestFeature,
			),
		).toBeTrue();
	});

	it("should accept a defaultPriceInRobux of 0 without coercing to undefined", () => {
		expect.assertions(1);

		expect(
			isPriceInformationLike({ defaultPriceInRobux: 0, enabledFeatures: [] }, isTestFeature),
		).toBeTrue();
	});

	it("should normalize a JSON null defaultPriceInRobux and accept the record", () => {
		// `JSON.parse` keeps null at runtime; the `?? undefined` step inside
		// the validator collapses it so the typeof guard treats absent and
		// nulled fields uniformly.
		expect.assertions(1);

		const value = JSON.parse('{ "defaultPriceInRobux": null, "enabledFeatures": [] }');

		expect(isPriceInformationLike(value, isTestFeature)).toBeTrue();
	});

	it("should reject when one feature in a non-empty list fails the injected guard", () => {
		// Mixed valid + invalid forces the loop to iterate past index 0; a
		// "remove loop body" mutant would otherwise pass the all-invalid
		// case by short-circuiting.
		expect.assertions(1);

		expect(
			isPriceInformationLike(
				{ defaultPriceInRobux: 50, enabledFeatures: ["alpha", "garbage"] },
				isTestFeature,
			),
		).toBeFalse();
	});

	it.for([
		{ scenario: "primitive string", value: "not an object" },
		{ scenario: "JSON null", value: JSON.parse("null") },
		{
			scenario: "array with named priceInformation properties",
			value: Object.assign([], { defaultPriceInRobux: 1, enabledFeatures: [] }),
		},
		{
			scenario: "defaultPriceInRobux is a string",
			value: { defaultPriceInRobux: "5", enabledFeatures: [] },
		},
		{
			scenario: "enabledFeatures is not an array",
			value: { defaultPriceInRobux: undefined, enabledFeatures: {} },
		},
	])("should reject when $scenario", ({ value }) => {
		expect.assertions(1);

		expect(isPriceInformationLike(value, isTestFeature)).toBeFalse();
	});
});

describe(copyPriceInformation, () => {
	it("should produce a structurally equal record", () => {
		expect.assertions(1);

		const wire: PriceInformationLike<TestFeature> = {
			defaultPriceInRobux: 100,
			enabledFeatures: ["alpha"],
		};

		expect(copyPriceInformation(wire)).toStrictEqual({
			defaultPriceInRobux: 100,
			enabledFeatures: ["alpha"],
		});
	});

	it("should return a fresh enabledFeatures array so callers cannot mutate the wire input", () => {
		// Identity assertion kills a "replace spread with []" mutant that a
		// length-zero or structural-equality test alone would not catch.
		expect.assertions(2);

		const wire: PriceInformationLike<TestFeature> = {
			defaultPriceInRobux: undefined,
			enabledFeatures: ["alpha", "beta"],
		};

		const result = copyPriceInformation(wire);

		expect(result.enabledFeatures).not.toBe(wire.enabledFeatures);
		expect(result.enabledFeatures).toStrictEqual(["alpha", "beta"]);
	});

	it("should preserve a defaultPriceInRobux of 0 instead of coercing to undefined", () => {
		// Kills a `?? undefined` → `|| undefined` mutant which would coerce
		// the falsy-but-valid `0` to undefined on the public shape.
		expect.assertions(1);

		const result = copyPriceInformation<TestFeature>({
			defaultPriceInRobux: 0,
			enabledFeatures: [],
		});

		expect(result.defaultPriceInRobux).toBe(0);
	});

	it("should preserve an undefined defaultPriceInRobux", () => {
		expect.assertions(1);

		const result = copyPriceInformation<TestFeature>({
			defaultPriceInRobux: undefined,
			enabledFeatures: [],
		});

		expect(result.defaultPriceInRobux).toBeUndefined();
	});
});
