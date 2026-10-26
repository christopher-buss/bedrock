import { describe, it } from "vitest";

import {
	forbidReadOnlyProperties,
	getAjv,
	listDeprecatedMultipartFields,
	listDeprecatedPropertyNames,
} from "./_helpers.ts";

describe(listDeprecatedPropertyNames, () => {
	it("should list deprecated component properties without including active fields", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(listDeprecatedPropertyNames("DeveloperProductConfigV2")).toStrictEqual([
			"storePageEnabled",
		]);
	});
});

describe(listDeprecatedMultipartFields, () => {
	it("should list deprecated properties on the selected multipart operation", ({ expect }) => {
		expect.assertions(1);

		expect(
			listDeprecatedMultipartFields(
				"/developer-products/v2/universes/{universeId}/developer-products/{productId}",
				"patch",
			),
		).toStrictEqual(["isRegionalPricingEnabled", "storePageEnabled"]);
	});
});

describe(forbidReadOnlyProperties, () => {
	it("should replace a readOnly property's schema with a never-match schema", ({ expect }) => {
		expect.assertions(1);

		expect(
			forbidReadOnlyProperties({
				properties: {
					id: { readOnly: true, type: "string" },
					name: { type: "string" },
				},
				type: "object",
			}),
		).toStrictEqual({
			properties: {
				id: { not: {} },
				name: { type: "string" },
			},
			type: "object",
		});
	});

	it("should also drop the readOnly property from required", ({ expect }) => {
		expect.assertions(1);

		expect(
			forbidReadOnlyProperties({
				properties: {
					id: { readOnly: true, type: "string" },
					name: { type: "string" },
				},
				required: ["id", "name"],
				type: "object",
			}),
		).toStrictEqual({
			properties: {
				id: { not: {} },
				name: { type: "string" },
			},
			required: ["name"],
			type: "object",
		});
	});

	it("should leave non-readOnly properties unchanged", ({ expect }) => {
		expect.assertions(1);

		expect(
			forbidReadOnlyProperties({
				properties: { name: { type: "string" } },
				type: "object",
			}),
		).toStrictEqual({
			properties: { name: { type: "string" } },
			type: "object",
		});
	});

	it("should recurse into nested schemas", ({ expect }) => {
		expect.assertions(1);

		expect(
			forbidReadOnlyProperties({
				properties: {
					child: {
						properties: {
							id: { readOnly: true, type: "string" },
						},
						type: "object",
					},
				},
				type: "object",
			}),
		).toStrictEqual({
			properties: {
				child: {
					properties: {
						id: { not: {} },
					},
					type: "object",
				},
			},
			type: "object",
		});
	});

	it("should return primitives unchanged", ({ expect }) => {
		expect.assertions(2);

		expect(forbidReadOnlyProperties("hello")).toBe("hello");
		expect(forbidReadOnlyProperties(42)).toBe(42);
	});
});

describe(getAjv, () => {
	it("should reject a request body that includes a readOnly Universe field", ({ expect }) => {
		expect.assertions(2);

		const validator = getAjv("request").getSchema(
			"roblox-openapi#/components/schemas/Universe",
		);

		expect(validator).toBeFunction();

		const isValid = validator!({ visibility: "PRIVATE" });

		expect(isValid).toBeFalse();
	});
});
