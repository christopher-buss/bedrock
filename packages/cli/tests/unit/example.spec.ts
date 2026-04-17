/**
 * This test file exists to verify ESLint vitest rules don't conflict. It
 * demonstrates patterns that comply with all configured rules.
 */

import { describe, expect, it } from "vitest";

describe("example test suite", () => {
	describe("basic assertions", () => {
		it("should pass a simple assertion", () => {
			expect.hasAssertions();

			const value = 1 + 1;

			expect(value).toBe(2);
		});

		it("should compare values correctly", () => {
			expect.hasAssertions();

			const a = 5;
			const b = 3;

			expect(a).toBeGreaterThan(b);
		});
	});

	describe("array operations", () => {
		it("should check array contains element", () => {
			expect.hasAssertions();

			const array = [1, 2, 3];

			expect(array).toContain(2);
		});

		it("should check array length", () => {
			expect.hasAssertions();

			const array = [1, 2, 3];

			expect(array).toHaveLength(3);
		});
	});

	describe("object operations", () => {
		it("should check object equality", () => {
			expect.hasAssertions();

			const object = { a: 1, b: 2 };

			expect(object).toStrictEqual({ a: 1, b: 2 });
		});
	});

	describe("boolean checks", () => {
		it("should check truthy value", () => {
			expect.hasAssertions();

			const isEnabled = true;

			expect(isEnabled).toBeTrue();
		});

		it("should check falsy value", () => {
			expect.hasAssertions();

			const isDisabled = false;

			expect(isDisabled).toBeFalse();
		});
	});

	describe("async operations", () => {
		it("should handle resolved promises", async () => {
			expect.hasAssertions();

			const promise = Promise.resolve(42);

			await expect(promise).resolves.toBe(42);
		});

		it("should handle rejected promises", async () => {
			expect.hasAssertions();

			const promise = Promise.reject(new Error("test error"));

			await expect(promise).rejects.toThrow("test error");
		});
	});

	describe.for([
		{ expected: 2, input: 1 },
		{ expected: 4, input: 2 },
		{ expected: 6, input: 3 },
	])("parameterized tests with input $input", ({ expected, input }) => {
		it("should double the input value", () => {
			expect.hasAssertions();

			const result = input * 2;

			expect(result).toBe(expected);
		});
	});
});
