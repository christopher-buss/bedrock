import { describe, expect, it } from "vitest";

import { toJsonDetails } from "./to-json-details.ts";

describe(toJsonDetails, () => {
	it("should return undefined when the value is absent", () => {
		expect.assertions(1);

		expect(toJsonDetails(undefined)).toBeUndefined();
	});

	it.for([
		["string", "boom"],
		["number", 42],
		["boolean", true],
		// eslint-disable-next-line unicorn/no-null -- JSON null is a JSONValue the parser must pass through
		["null", null],
	] as const)("should pass through the %s primitive", ([, value]) => {
		expect.assertions(1);

		expect(toJsonDetails(value)).toStrictEqual(value);
	});

	it("should pass through a nested object graph unchanged", () => {
		expect.assertions(1);

		const body = { errors: [{ code: "NotFound", retryable: false }], message: "nope" };

		expect(toJsonDetails(body)).toStrictEqual(body);
	});

	it("should return undefined when a value is not JSON-representable", () => {
		expect.assertions(1);

		expect(toJsonDetails(() => {})).toBeUndefined();
	});

	it("should return undefined when a nested value is not JSON-representable", () => {
		expect.assertions(1);

		expect(toJsonDetails({ retry: Symbol("nope") })).toBeUndefined();
	});

	it("should return undefined when an array element is not JSON-representable", () => {
		expect.assertions(1);

		expect(toJsonDetails([1, 2n])).toBeUndefined();
	});

	it("should return undefined when the graph is cyclic", () => {
		expect.assertions(1);

		const cyclic: Record<string, unknown> = {};
		cyclic["self"] = cyclic;

		expect(toJsonDetails(cyclic)).toBeUndefined();
	});

	it("should return undefined when an array holds itself", () => {
		expect.assertions(1);

		const cyclic: Array<unknown> = [];
		cyclic.push(cyclic);

		expect(toJsonDetails(cyclic)).toBeUndefined();
	});

	it("should reject a class instance rather than coercing it to a record", () => {
		expect.assertions(1);

		expect(toJsonDetails(new Error("boom"))).toBeUndefined();
	});
});
