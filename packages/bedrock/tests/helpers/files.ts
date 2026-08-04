/**
 * Build a fake file reader that answers each path from a fixture table: bytes
 * resolve, an {@link Error} is thrown. Lets a test state which reads are
 * expected (and which must not happen) as data.
 *
 * @param byPath - Fixture bytes or error per path.
 * @param fallback - Answer for a path the table omits; throws by default.
 * @returns The fake reader.
 * @rejects With the fixture error when the matched entry is an `Error`.
 */
export function fakeReadFile(
	byPath: Readonly<Record<string, Error | Uint8Array>>,
	fallback?: Error | Uint8Array,
): (path: string) => Promise<Uint8Array> {
	return async (path) => {
		const answer = byPath[path] ?? fallback ?? new Error(`no read fixture for '${path}'`);
		if (answer instanceof Error) {
			throw answer;
		}

		// Resolve on a later microtask, as a real filesystem read does.
		await Promise.resolve();
		return answer;
	};
}
