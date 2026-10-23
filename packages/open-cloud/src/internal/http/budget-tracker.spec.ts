import { describe, it } from "vitest";

import { BudgetTracker } from "./budget-tracker.ts";
import type { RateLimitWindow } from "./rate-limit-sample.ts";

const DOCUMENTED_WINDOW = { capacity: 3, windowSeconds: 1 } satisfies RateLimitWindow;

function reserveAt(tracker: BudgetTracker, times: ReadonlyArray<number>): void {
	for (const now of times) {
		tracker.reserve(now);
	}
}

describe(BudgetTracker, () => {
	it("should not wait before any sample is observed", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should let the first paced send go immediately while budget remains", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 4, resetSeconds: 60 }, 0);

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should space later sends evenly across the time left in the window", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 4, resetSeconds: 60 }, 0);
		tracker.reserve(0);

		// 3 left over the 60s window → one every 20s.
		expect(tracker.waitMs(0)).toBe(20_000);
	});

	it("should not wait once the spaced slot has already passed", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 2, resetSeconds: 60 }, 0);
		tracker.reserve(0);

		expect(tracker.waitMs(50_000)).toBe(0);
	});

	it("should hold until reset once a reserve exhausts the budget", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 1, resetSeconds: 60 }, 0);
		tracker.reserve(0);

		expect(tracker.waitMs(0)).toBe(60_000);
	});

	it("should not wait at the instant the window resets", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);

		expect(tracker.waitMs(1000)).toBe(0);
	});

	it("should not wait once the window has passed", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);

		expect(tracker.waitMs(1500)).toBe(0);
	});

	it("should hold the time left just before the window resets", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);

		expect(tracker.waitMs(999)).toBe(1);
	});

	it("should not throw or wait when reserving while unprimed", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.reserve(0);

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should let a fresh reading replace an exhausted window", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 60 }, 0);
		tracker.observe({ remaining: 5, resetSeconds: 60 }, 0);

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should admit only the documented capacity in the window after a reset", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);
		reserveAt(tracker, [1000, 1000, 1000]);

		expect(tracker.waitMs(1000)).toBe(1000);
	});

	it("should admit the reported capacity over the documented one after a reset", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker({ capacity: 10, windowSeconds: 1 });
		tracker.observe(
			{ remaining: 0, resetSeconds: 1, window: { capacity: 2, windowSeconds: 5 } },
			0,
		);
		reserveAt(tracker, [1000, 1000]);

		expect(tracker.waitMs(1000)).toBe(5000);
	});

	it("should keep the last reported capacity when a later reading omits it", ({ expect }) => {
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

	it("should keep admitting the reported capacity each window with no fresh reading", ({
		expect,
	}) => {
		expect.assertions(1);

		const tracker = new BudgetTracker({ capacity: 10, windowSeconds: 1 });
		tracker.observe(
			{ remaining: 0, resetSeconds: 1, window: { capacity: 2, windowSeconds: 5 } },
			0,
		);

		const waits = [1000, 3500, 6000].map((now) => {
			tracker.reserve(now);
			return tracker.waitMs(now);
		});

		expect(waits).toStrictEqual([2500, 2500, 2500]);
	});

	it("should start the next window when the request arrives long after a reset", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 0, resetSeconds: 1 }, 0);
		reserveAt(tracker, [3500, 3500, 3500]);

		expect(tracker.waitMs(3500)).toBe(1000);
	});

	it("should restore the budget a released reservation took", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 1, resetSeconds: 60 }, 0);
		tracker.reserve(0).release();

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should restore the pacing clock a released reservation set", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 4, resetSeconds: 60 }, 0);
		tracker.reserve(0).release();

		expect(tracker.waitMs(0)).toBe(0);
	});

	it("should keep a later reservation's pacing when an earlier one is released", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 4, resetSeconds: 60 }, 0);
		const earlier = tracker.reserve(0);
		tracker.reserve(15_000);
		earlier.release();

		// 3 left over the 45s still to go, so one every 15s after 15s.
		expect(tracker.waitMs(15_000)).toBe(15_000);
	});

	it("should not restore budget into a window a fresh reading replaced", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 4, resetSeconds: 60 }, 0);
		const released = tracker.reserve(0);
		tracker.observe({ remaining: 1, resetSeconds: 30 }, 0);
		released.release();
		tracker.reserve(0);

		expect(tracker.waitMs(10_000)).toBe(20_000);
	});

	it("should not restore budget into a window opened by a rollover", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 1, resetSeconds: 1 }, 0);
		const released = tracker.reserve(0);
		reserveAt(tracker, [2000, 2000, 2000]);
		released.release();

		expect(tracker.waitMs(2000)).toBe(1000);
	});

	it("should restore the budget only once when a reservation is released twice", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.observe({ remaining: 1, resetSeconds: 60 }, 0);
		const released = tracker.reserve(0);
		released.release();
		released.release();
		tracker.reserve(0);

		expect(tracker.waitMs(10_000)).toBe(50_000);
	});

	it("should release a reservation made while unprimed", ({ expect }) => {
		expect.assertions(1);

		const tracker = new BudgetTracker(DOCUMENTED_WINDOW);
		tracker.reserve(0).release();

		expect(tracker.waitMs(0)).toBe(0);
	});
});
