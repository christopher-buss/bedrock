/**
 * Build an async fake that resolves the supplied values in order, repeating the
 * final one once the queue is exhausted. Lets a test state "succeeds, then
 * fails" as data rather than counting calls inside the fake.
 *
 * @template Value - The resolved value type.
 * @param values - The values to resolve, in call order.
 * @returns The fake.
 * @rejects When constructed with an empty sequence.
 */
export function resultsInOrder<Value>(values: ReadonlyArray<Value>): () => Promise<Value> {
	let index = 0;
	return async () => {
		const value = values[Math.min(index, values.length - 1)];
		index += 1;
		if (value === undefined) {
			throw new Error("resultsInOrder: no values queued");
		}

		// Resolve on a later microtask, as the real call being faked does.
		await Promise.resolve();
		return value;
	};
}
