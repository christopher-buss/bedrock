/**
 * A clock whose only motion is the waiting the code under test asks for,
 * so a retry loop that drains a timeout runs to its end instantly and the
 * instants it records are the same on every machine.
 */
export interface FakeClock {
	/** Reads the clock, in epoch milliseconds. */
	readonly now: () => number;
	/** Waits, by moving the clock rather than by taking any real time. */
	readonly sleepAsync: (ms: number) => Promise<void>;
	/** Every `ms` value `sleep` was asked for, in order. */
	readonly waits: ReadonlyArray<number>;
}

/**
 * A repeating schedule nothing fires but the test itself.
 */
export interface FakeSchedule {
	/** How many times the schedule was cancelled. */
	readonly cancelled: () => number;
	/** Every interval the schedule was asked for, in order. */
	readonly every: ReadonlyArray<number>;
	/** The seam to hand the code under test. */
	readonly scheduleEvery: (ms: number, run: () => Promise<void>) => () => void;
	/** Fire the schedule once, settling whatever it started. */
	readonly tickAsync: () => Promise<void>;
}

/**
 * Build a clock that only moves when something waits on it.
 *
 * @param startAt - Instant the clock reads before anything waits.
 * @returns The clock, plus the log of what waited on it.
 */
export function createFakeClock(startAt = 0): FakeClock {
	let time = startAt;
	const waits: Array<number> = [];

	return {
		now: () => time,
		async sleepAsync(ms) {
			waits.push(ms);
			time += ms;
			// Settle on a later microtask, as a real timer-backed wait does.
			await Promise.resolve();
		},
		waits,
	};
}

/**
 * Build a repeating schedule a test drives by hand, so work that would run
 * on a timer runs exactly when the test says it does.
 *
 * @returns The schedule, plus what was asked of it.
 */
export function createFakeSchedule(): FakeSchedule {
	const every: Array<number> = [];
	let cancels = 0;
	let scheduled: (() => Promise<void>) | undefined;

	return {
		cancelled: () => cancels,
		every,
		scheduleEvery(ms, run) {
			every.push(ms);
			scheduled = run;
			return () => {
				cancels += 1;
			};
		},
		async tickAsync() {
			await scheduled?.();
		},
	};
}
