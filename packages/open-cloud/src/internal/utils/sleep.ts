import { setTimeout } from "node:timers/promises";

/**
 * Injectable sleep function signature for testing.
 *
 * @since 0.1.0
 */
export type SleepFunc = (ms: number, signal?: AbortSignal) => Promise<void>;

/**
 * Timer-backed production sleep that releases its timer on cancellation.
 *
 * @param ms - Duration to wait in milliseconds.
 * @param signal - Optional caller cancellation signal.
 */
export async function defaultSleepAsync(ms: number, signal?: AbortSignal): Promise<void> {
	await setTimeout(ms, undefined, { signal });
}
