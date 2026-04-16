import type { SleepFunc } from "#src/internal/utils/sleep";

/** A sleep double that records its wait arguments without delaying. */
export interface FakeSleep {
	/** A sleep function that records `ms` and resolves immediately. */
	readonly sleep: SleepFunc;
	/** Chronological log of every `ms` value `sleep` was called with. */
	readonly waits: ReadonlyArray<number>;
}

/**
 * Creates a {@link SleepFunc} that resolves immediately and records every
 * `ms` value it was called with.
 *
 * @returns A sleep function and a `waits` log.
 */
export function createFakeSleep(): FakeSleep {
	const waits: Array<number> = [];

	async function sleep(ms: number): Promise<void> {
		waits.push(ms);
	}

	return { sleep, waits };
}
