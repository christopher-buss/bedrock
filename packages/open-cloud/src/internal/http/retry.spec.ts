import { describe, expect, it } from "vitest";

import { defaultRetryDelay } from "./retry.ts";

describe(defaultRetryDelay, () => {
	it("should return 1000ms for attempt 0", () => {
		expect.assertions(1);

		expect(defaultRetryDelay(0)).toBe(1000);
	});

	it("should return 2000ms for attempt 1", () => {
		expect.assertions(1);

		expect(defaultRetryDelay(1)).toBe(2000);
	});

	it("should return 4000ms for attempt 2", () => {
		expect.assertions(1);

		expect(defaultRetryDelay(2)).toBe(4000);
	});

	it("should return 8000ms for attempt 3", () => {
		expect.assertions(1);

		expect(defaultRetryDelay(3)).toBe(8000);
	});

	it("should cap at 30000ms for large attempts", () => {
		expect.assertions(1);

		expect(defaultRetryDelay(10)).toBe(30_000);
	});
});
