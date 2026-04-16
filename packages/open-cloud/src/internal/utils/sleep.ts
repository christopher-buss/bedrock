/** Injectable sleep function signature for testing. */
export type SleepFunc = (ms: number) => Promise<void>;

/**
 * Default sleep implementation using setTimeout.
 *
 * @param ms - Milliseconds to sleep.
 * @returns A promise that resolves after the delay.
 */
export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
