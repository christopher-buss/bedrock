import { describe, expect, it } from "vitest";

import { backoffDelayMs } from "./backoff.ts";

const PLENTY_LEFT = 300_000;

describe(backoffDelayMs, () => {
	it("should double the wait for each attempt the store refused", () => {
		expect.assertions(1);

		const waits = [1, 2, 3, 4].map((attempt) => {
			return backoffDelayMs({ attempt, remainingMs: PLENTY_LEFT });
		});

		expect(waits).toStrictEqual([1000, 2000, 4000, 8000]);
	});

	it("should stop growing so a hold given up early is picked up soon after", () => {
		expect.assertions(1);

		expect(backoffDelayMs({ attempt: 20, remainingMs: PLENTY_LEFT })).toBe(30_000);
	});

	it("should land the next attempt on the deadline rather than past it", () => {
		expect.assertions(1);

		expect(backoffDelayMs({ attempt: 8, remainingMs: 250 })).toBe(250);
	});

	it("should never wait once the deadline has passed", () => {
		expect.assertions(1);

		expect(backoffDelayMs({ attempt: 1, remainingMs: -5000 })).toBe(0);
	});
});
