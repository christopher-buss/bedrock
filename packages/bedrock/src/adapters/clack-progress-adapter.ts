import { type ClackPort, renderDeployError } from "../cli/render.ts";
import type { ProgressEvent, ProgressPort } from "../ports/progress-port.ts";

/**
 * Configuration for {@link createClackProgressAdapter}.
 */
export interface ClackProgressAdapterDeps {
	/** Output port the events are rendered through. */
	readonly clack: ClackPort;
}

/**
 * Build a {@link ProgressPort} that renders events through a `ClackPort`.
 * Pattern-matches on the event `kind`: `deploySuccess` becomes a single
 * success line and `deployFailure` delegates to the package's deploy-error
 * rendering helper.
 *
 * @example
 *
 * ```ts
 * import { createClackProgressAdapter, type ClackPort } from "@bedrock-rbx/core";
 *
 * const lines: Array<string> = [];
 * const clack: ClackPort = {
 *     cancel: (message) => lines.push(`cancel: ${message}`),
 *     intro: (message) => lines.push(`intro: ${message}`),
 *     logError: (message) => lines.push(`error: ${message}`),
 *     logMessage: (message) => lines.push(`log: ${message}`),
 *     logSuccess: (message) => lines.push(`ok: ${message}`),
 *     outro: (message) => lines.push(`outro: ${message}`),
 * };
 *
 * const port = createClackProgressAdapter({ clack });
 *
 * port.emit({ environment: "production", kind: "deploySuccess", resourceCount: 3 });
 *
 * expect(lines).toEqual(["ok: production: 3 resources reconciled"]);
 * ```
 *
 * @param deps - The clack port the adapter renders through.
 * @returns A `ProgressPort` that renders via clack.
 */
export function createClackProgressAdapter(deps: ClackProgressAdapterDeps): ProgressPort {
	const { clack } = deps;
	return {
		emit(event: ProgressEvent): void {
			switch (event.kind) {
				case "deployFailure": {
					renderDeployError(event.error, clack);
					return;
				}
				case "deploySuccess": {
					clack.logSuccess(
						`${event.environment}: ${event.resourceCount} resources reconciled`,
					);
				}
			}
		},
	};
}
