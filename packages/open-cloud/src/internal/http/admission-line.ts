import type { AdmissionWaitSpan } from "./admission-wait.ts";

/**
 * One serialized admission line: an operation's token bucket, or one budget
 * scope's window. Holds the spans of every request currently queued on it, so
 * a request that begins sleeping can report that everyone behind it is
 * waiting too — on a schedule none of them can name until their own turn
 * computes it.
 */
export class AdmissionLine {
	readonly #held = new Set<AdmissionWaitSpan>();

	#sleeping = 0;

	/**
	 * Runs one request's admission sleep, reporting the wait it names and the
	 * waits it imposes on every request behind it.
	 *
	 * @template T - Value the sleep resolves with.
	 * @param sleepAsync - The sleep to run while the line is held.
	 * @param wait - The sleeping request's span and its intended duration.
	 * @returns The value the sleep resolved with.
	 */
	public async holdAsync<T>(
		sleepAsync: () => Promise<T>,
		wait: { readonly span: AdmissionWaitSpan; readonly waitMs: number },
	): Promise<T> {
		wait.span.begin(wait.waitMs);
		for (const held of this.#held) {
			held.begin();
		}

		this.#sleeping += 1;
		try {
			return await sleepAsync();
		} finally {
			this.#sleeping -= 1;
		}
	}

	/**
	 * Adds a request to the line, reporting it as already waiting when the
	 * line is held by a sleeping request.
	 *
	 * @param span - The joining request's wait span.
	 */
	public join(span: AdmissionWaitSpan): void {
		this.#held.add(span);
		if (this.#sleeping > 0) {
			span.begin();
		}
	}

	/**
	 * Removes a request from the line and ends its wait, if it had one.
	 *
	 * @param span - The leaving request's wait span.
	 */
	public leave(span: AdmissionWaitSpan): void {
		this.#held.delete(span);
		span.end();
	}
}
