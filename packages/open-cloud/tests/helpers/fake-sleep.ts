import type { SleepFunc } from "#src/internal/utils/sleep";

/**
 * A directly-callable sleep double that records its wait arguments without
 * delaying. Assignable to {@link SleepFunc}.
 */
export interface FakeSleep extends SleepFunc {
	/** Chronological log of every `ms` value the fake was called with. */
	readonly waits: ReadonlyArray<number>;
}

/**
 * Creates a {@link FakeSleep} that resolves immediately and records every
 * `ms` value it was called with.
 *
 * @returns A callable sleep function with a `waits` log attached.
 */
export function createFakeSleep(): FakeSleep {
	const waits: Array<number> = [];

	async function sleep(ms: number): Promise<void> {
		waits.push(ms);
	}

	const fake: FakeSleep = Object.assign(sleep, {
		get waits(): ReadonlyArray<number> {
			return waits;
		},
	});

	return fake;
}
