import type { ProgressPort } from "../ports/progress-port.ts";

/**
 * Build a {@link ProgressPort} that silently drops every event. Useful for
 * tests and programmatic callers who want to invoke deploy logic without
 * any rendering.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { createNoOpProgressAdapter } from "@bedrock-rbx/core";
 *
 * const port = createNoOpProgressAdapter();
 *
 * expect(() =>
 *     port.emit({ environment: "production", kind: "deploySuccess", resourceCount: 3 }),
 * ).not.toThrow();
 * ```
 *
 * @returns A `ProgressPort` whose `emit` method is a no-op.
 */
export function createNoOpProgressAdapter(): ProgressPort {
	return {
		emit() {
			/* no-op */
		},
	};
}
