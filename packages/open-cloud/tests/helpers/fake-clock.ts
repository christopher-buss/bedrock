import type { SleepFunc } from "#src/internal/utils/sleep";
import { onTestFinished, vi } from "vitest";

/**
 * A clock test double where sleeping also advances the mocked
 * `Date.now()` by `ms`, so production code that drains by wall time
 * sees deterministic elapsed intervals without real-time drift. The
 * `Date.now` spy is restored automatically when the current test
 * finishes.
 */
export interface FakeClock {
	/** Moves the mocked clock forward without pushing onto `waits`. */
	readonly advance: (ms: number) => void;
	/** A {@link SleepFunc} that records every `ms` and advances the clock. */
	readonly sleep: SleepFunc;
	/** Every `ms` value `sleep` was called with, in order. */
	readonly waits: ReadonlyArray<number>;
}

/**
 * Builds a {@link FakeClock} and installs a `Date.now` spy. The spy is
 * restored via `onTestFinished`, so each test that calls this helper
 * gets a fresh, isolated clock.
 *
 * @returns A clock with a tracking `sleep`, a `waits` log, and `advance`.
 */
export function createFakeClock(): FakeClock {
	let time = 0;
	const waits: Array<number> = [];
	const spy = vi.spyOn(Date, "now").mockImplementation(() => time);
	onTestFinished(() => {
		spy.mockRestore();
	});
	return {
		advance(ms) {
			time += ms;
		},
		async sleep(ms) {
			waits.push(ms);
			time += ms;
		},
		waits,
	};
}
