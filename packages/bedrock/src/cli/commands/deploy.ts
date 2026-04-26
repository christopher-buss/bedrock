import process from "node:process";

import { EXIT_ERROR } from "../exit-codes.ts";
import type { ProgDeps } from "../index.ts";
import { parseCommonOptions } from "../parse-options.ts";
import { createClackPort, renderParseError } from "../render.ts";

/**
 * Build the sade action for `bedrock deploy`. The returned function consumes
 * the raw options object sade hands the action callback, parses it via
 * `parseCommonOptions`, and routes any parse failure through
 * `renderParseError` before exiting non-zero.
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function deployCommand(
	deps: ProgDeps,
): (rawOptions: Record<string, unknown>) => Promise<void> {
	const clack = deps.clack ?? createClackPort();
	const exit = deps.exit ?? ((code: number) => process.exit(code));

	return async (rawOptions) => {
		clack.intro("bedrock deploy");

		const parsed = parseCommonOptions(rawOptions);
		if (!parsed.success) {
			renderParseError(parsed.err, clack);
			clack.cancel("deploy failed");
			return exit(EXIT_ERROR);
		}
	};
}
