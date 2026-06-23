import { cancel, intro, log, outro } from "@clack/prompts";

import type { ClackPort } from "./render.ts";

/**
 * Construct a `ClackPort` whose methods delegate to `@clack/prompts`. The
 * resulting port writes to `process.stdout` via clack's defaults. Kept in
 * its own module so consumers that never need the clack-backed rendering
 * (programmatic deploys, custom adapters) do not pull `@clack/prompts`
 * into their bundle.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { createClackPort } from "@bedrock-rbx/core";
 *
 * const port = createClackPort();
 *
 * expect(typeof port.logSuccess).toBe("function");
 * ```
 *
 * @returns A port whose six methods each invoke the matching clack helper.
 */
export function createClackPort(): ClackPort {
	return {
		cancel: (message) => {
			cancel(message);
		},
		intro: (message) => {
			intro(message);
		},
		logError: (message) => {
			log.error(message);
		},
		logMessage: (message) => {
			log.message(message);
		},
		logSuccess: (message) => {
			log.success(message);
		},
		outro: (message) => {
			outro(message);
		},
	};
}
