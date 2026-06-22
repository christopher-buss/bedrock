import { describe, expect, it } from "vitest";

import { BudgetTracker } from "./budget-tracker.ts";

describe(BudgetTracker, () => {
	it("should not wait before any sample is observed", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker();

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should let the first paced send go immediately while budget remains", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker();
		tracker.observe({ remaining: 4, resetSeconds: 60 }, 0);

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should space later sends evenly across the time left in the window", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker();
		tracker.observe({ remaining: 4, resetSeconds: 60 }, 0);
		tracker.reserve(0);

		// 3 left over the 60s window → one every 20s.
		expect(tracker.waitMs(0)).toBe(20_000);
	});

	it("should not wait once the spaced slot has already passed", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker();
		tracker.observe({ remaining: 2, resetSeconds: 60 }, 0);
		tracker.reserve(0);

		expect(tracker.waitMs(50_000)).toBe(0);
	});

	it("should hold until reset once a reserve exhausts the budget", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker();
		tracker.observe({ remaining: 1, resetSeconds: 60 }, 0);
		tracker.reserve(0);

		expect(tracker.waitMs(0)).toBe(60_000);
	});

	it("should not wait at the instant the window resets", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker();
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);

		expect(tracker.waitMs(1000)).toBe(0);
	});

	it("should not wait once the window has passed", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker();
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);

		expect(tracker.waitMs(1500)).toBe(0);
	});

	it("should hold the time left just before the window resets", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker();
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);

		expect(tracker.waitMs(999)).toBe(1);
	});

	it("should not throw or wait when reserving while unprimed", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker();
		tracker.reserve(0);

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should let a fresh reading replace an exhausted window", () => {
		expect.assertions(1);

		const tracker = new BudgetTracker();
		tracker.observe({ remaining: 0, resetSeconds: 60 }, 0);
		tracker.observe({ remaining: 5, resetSeconds: 60 }, 0);

		expect(tracker.waitMs(0)).toBe(0);
	});
});
