import process from "node:process";
import { onTestFinished } from "vitest";

/**
 * Put the named variables on the process environment for one test, so the
 * standard AWS credential chain has something to resolve, and take them
 * back off once it finishes.
 *
 * @param variables - Environment variables to set for the test.
 */
export function withEnvironment(variables: Readonly<Record<string, string>>): void {
	const previous = Object.entries(variables).map(([name]) => [name, process.env[name]] as const);
	onTestFinished(() => {
		for (const [name, value] of previous) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
	});

	for (const [name, value] of Object.entries(variables)) {
		process.env[name] = value;
	}
}
