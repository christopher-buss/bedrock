import { describe, expect, it } from "vitest";

import { forbidReadOnlyProperties, getAjv } from "./_helpers.ts";

describe(forbidReadOnlyProperties, () => {
	it("should replace a readOnly property's schema with a never-match schema", () => {
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

	it("should also drop the readOnly property from required", () => {
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

	it("should leave non-readOnly properties unchanged", () => {
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

	it("should recurse into nested schemas", () => {
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

	it("should return primitives unchanged", () => {
		expect.assertions(2);
		expect(forbidReadOnlyProperties("hello")).toBe("hello");
		expect(forbidReadOnlyProperties(42)).toBe(42);
	});
});

describe(getAjv, () => {
	it("should reject a request body that includes a readOnly Universe field", () => {
		expect.assertions(2);

		const validator = getAjv("request").getSchema(
			"roblox-openapi#/components/schemas/Universe",
		);

		expect(validator).toBeFunction();

		const isValid = validator?.({ visibility: "PRIVATE" });

		expect(isValid).toBeFalse();
	});
});
