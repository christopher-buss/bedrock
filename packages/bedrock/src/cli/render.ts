import { cancel, intro, log, outro } from "@clack/prompts";

/**
 * Output port the CLI renders through. Mirrors the subset of `@clack/prompts`
 * the bedrock CLI uses today; tests inject a fake to assert what was rendered.
 */
export interface ClackPort {
	/** End an interactive flow with a cancellation marker. */
	cancel(message: string): void;
	/** Open a framed section with a title (used for command intros). */
	intro(message: string): void;
	/** Render a single error line inside an open frame. */
	logError(message: string): void;
	/** Render a single neutral line inside an open frame. */
	logMessage(message: string): void;
	/** Render a single success line inside an open frame. */
	logSuccess(message: string): void;
	/** Close the current framed section with a final message. */
	outro(message: string): void;
}

/**
 * Construct a `ClackPort` whose methods delegate to `@clack/prompts`. The
 * resulting port writes to `process.stdout` via clack's defaults.
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
