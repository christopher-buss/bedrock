import { describe, expect, it } from "vitest";

import { BudgetTracker } from "./budget-tracker.ts";
import type { RateLimitWindow } from "./rate-limit-sample.ts";

const DOCUMENTED_WINDOW = { capacity: 3, windowSeconds: 1 } satisfies RateLimitWindow;

function reserveAt(tracker: BudgetTracker, times: ReadonlyArray<number>): void {
	for (const now of times) {
		tracker.reserve(now);
	}
}

describe(BudgetTracker, () => {
	it("should not wait before any sample is observed", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should let the first paced send go immediately while budget remains", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 4, resetSeconds: 60 }, 0);

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should space later sends evenly across the time left in the window", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 4, resetSeconds: 60 }, 0);
		tracker.reserve(0);

		// 3 left over the 60s window → one every 20s.
		expect(tracker.waitMs(0)).toBe(20_000);
	});

	it("should not wait once the spaced slot has already passed", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 2, resetSeconds: 60 }, 0);
		tracker.reserve(0);

		expect(tracker.waitMs(50_000)).toBe(0);
	});

	it("should hold until reset once a reserve exhausts the budget", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 1, resetSeconds: 60 }, 0);
		tracker.reserve(0);

		expect(tracker.waitMs(0)).toBe(60_000);
	});

	it("should not wait at the instant the window resets", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);

		expect(tracker.waitMs(1000)).toBe(0);
	});

	it("should not wait once the window has passed", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);

		expect(tracker.waitMs(1500)).toBe(0);
	});

	it("should hold the time left just before the window resets", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);

		expect(tracker.waitMs(999)).toBe(1);
	});

	it("should not throw or wait when reserving while unprimed", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.reserve(0);

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should let a fresh reading replace an exhausted window", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 60 }, 0);
		tracker.observe({ remaining: 5, resetSeconds: 60 }, 0);

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should admit only the documented capacity in the window after a reset", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);
		reserveAt(tracker, [1000, 1000, 1000]);

		expect(tracker.waitMs(1000)).toBe(1000);
	});

	it("should admit the reported capacity over the documented one after a reset", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker({ capacity: 10, windowSeconds: 1 });
		tracker.observe(
			{ remaining: 0, resetSeconds: 1, window: { capacity: 2, windowSeconds: 5 } },
			0,
		);
		reserveAt(tracker, [1000, 1000]);

		expect(tracker.waitMs(1000)).toBe(5000);
	});

	it("should keep the last reported capacity when a later reading omits it", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker({ capacity: 10, windowSeconds: 1 });
		tracker.observe(
			{ remaining: 1, resetSeconds: 1, window: { capacity: 2, windowSeconds: 5 } },
			0,
		);
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);
		reserveAt(tracker, [1000, 1000]);

		expect(tracker.waitMs(1000)).toBe(5000);
	});

	it("should start the next window when the request arrives long after a reset", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);
		reserveAt(tracker, [3500, 3500, 3500]);

		expect(tracker.waitMs(3500)).toBe(1000);
	});
});
