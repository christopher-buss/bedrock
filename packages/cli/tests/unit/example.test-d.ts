/**
 * Type-level tests using expectTypeOf. These tests verify TypeScript types at
 * compile time.
 */

import { describe, expectTypeOf, it } from "vitest";

describe("type assertions", () => {
	it("should verify string type", () => {
		const value = "hello";

		expectTypeOf(value).toBeString();
	});

	it("should verify number type", () => {
		const value = 42;

		expectTypeOf(value).toBeNumber();
	});

	it("should verify boolean type", () => {
		const isEnabled = true;

		expectTypeOf(isEnabled).toBeBoolean();
	});

	it("should verify object type", () => {
		const value = { a: 1 };

		expectTypeOf(value).toBeObject();
	});

	it("should verify array type", () => {
		const value = [1, 2, 3];

		expectTypeOf(value).toBeArray();
	});

	it("should verify function type", () => {
		// eslint-disable-next-line ts/no-empty-function, unicorn/consistent-function-scoping -- intentionally empty for type testing
		function noop(): void {}

		expectTypeOf(noop).toBeFunction();
	});

	it("should verify nullable type", () => {
		const value: string | undefined = undefined;

		expectTypeOf(value).toBeNullable();
	});
});
