/**
 * Build an env reader backed by a plain record, so a test states the variables
 * it provides as data rather than branching on the requested name.
 *
 * @param values - The variables to expose.
 * @returns The reader, which returns `undefined` for anything else.
 */
export function environmentFrom(
	values: Readonly<Record<string, string>>,
): (name: string) => string | undefined {
	return (name) => values[name];
}
