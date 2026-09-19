/**
 * Sentinel returned when an asynchronous operation loses a race with a signal.
 */
export const ABORTED = Symbol("aborted");

/**
 * Result of an operation raced against an optional caller signal.
 *
 * @template T - Value produced when the operation wins the race.
 */
export type AbortableResult<T> = T | typeof ABORTED;

/**
 * Runs an asynchronous operation and resolves with {@link ABORTED} when the
 * supplied signal fires first. The underlying operation still receives the
 * signal separately so cancellable implementations can release their work.
 *
 * @template T - Value produced by the operation.
 * @param operation - Operation to start after the abort observer is installed.
 * @param signal - Optional caller cancellation signal.
 * @returns The operation's value, or {@link ABORTED} when cancellation wins.
 * @rejects The operation's error when it fails before cancellation.
 */
export async function raceWithAbortAsync<T>(
	operation: () => Promise<T>,
	signal: AbortSignal | undefined,
): Promise<AbortableResult<T>> {
	if (signal === undefined) {
		return operation();
	}

	if (signal.aborted) {
		return ABORTED;
	}

	const { promise, resolve } = Promise.withResolvers<typeof ABORTED>();
	function onAbort(): void {
		resolve(ABORTED);
	}

	signal.addEventListener("abort", onAbort);
	try {
		return await Promise.race([operation(), promise]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
