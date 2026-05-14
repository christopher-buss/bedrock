import type { DeployError } from "../shell/deploy.ts";

/**
 * Per-environment outcome event emitted after a deploy completes
 * successfully. Carries the environment name and the count of resources
 * present in the persisted state snapshot.
 */
export interface DeploySuccessEvent {
	/** The environment that finished reconciling. */
	readonly environment: string;
	/** Discriminator tag. */
	readonly kind: "deploySuccess";
	/** Number of resources in the post-deploy state snapshot. */
	readonly resourceCount: number;
}

/**
 * Per-environment outcome event emitted when a deploy fails. Carries the
 * environment name and the full {@link DeployError} so a renderer can
 * delegate to the existing diagnostic helpers.
 */
export interface DeployFailureEvent {
	/** The environment whose deploy failed. */
	readonly environment: string;
	/** Stage-tagged failure reason returned by the shell `deploy` function. */
	readonly error: DeployError;
	/** Discriminator tag. */
	readonly kind: "deployFailure";
}

/**
 * Discriminated union of progress events the CLI emits while a deploy
 * runs. The variant set is additive: future per-stage and per-resource
 * events land as new `kind` values without breaking existing adapters.
 */
export type ProgressEvent = DeployFailureEvent | DeploySuccessEvent;

/**
 * Plugin contract for receiving deploy outcomes: the interface an adapter
 * (clack renderer, JSON logger, custom UI) implements to let the CLI hand
 * off events without re-implementing rendering logic.
 *
 * `ProgressPort` is a *driven* (secondary) port in hexagonal terms.
 *
 * @example
 *
 * ```ts
 * import type { ProgressEvent, ProgressPort } from "@bedrock-rbx/core";
 *
 * let received: ReadonlyArray<ProgressEvent> = [];
 * const port: ProgressPort = {
 *     emit(event) {
 *         received = [...received, event];
 *     },
 * };
 *
 * port.emit({ environment: "production", kind: "deploySuccess", resourceCount: 3 });
 *
 * expect(received).toEqual([
 *     { environment: "production", kind: "deploySuccess", resourceCount: 3 },
 * ]);
 * ```
 */
export interface ProgressPort {
	/** Hand a single progress event to the adapter for rendering or logging. */
	emit(event: ProgressEvent): void;
}
