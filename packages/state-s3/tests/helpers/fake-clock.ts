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
