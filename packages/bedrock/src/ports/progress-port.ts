import type { ResourceKind, ResourceOutputs } from "../core/resources.ts";
import type { ApplyError } from "../shell/apply-ops.ts";
import type { DeployError } from "../shell/deploy.ts";
import type { ResourceKey } from "../types/ids.ts";

/**
 * Per-environment outcome event emitted after a deploy completes
 * successfully. Carries the environment name and the count of resources
 * present in the persisted state snapshot.
 *
 * @since 0.1.0
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
 *
 * @since 0.1.0
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
 * Per-resource event emitted immediately before `applyOps` dispatches a
 * non-noop op to its driver. Adapters may render a "starting" line or
 * stay silent; the matching terminal event ({@link ResourceOpSucceededEvent}
 * or {@link ResourceOpFailedEvent}) fires when the driver settles.
 *
 * @since 0.1.0
 */
export interface ResourceOpStartedEvent {
	/** User-supplied resource key. */
	readonly key: ResourceKey;
	/** Environment whose reconcile is running. */
	readonly environment: string;
	/** Discriminator tag. */
	readonly kind: "resourceOpStarted";
	/** Operation type being dispatched. Noops never fire this event. */
	readonly opType: "create" | "update";
	/** Resource-kind discriminator (`gamePass`, `place`, ...). */
	readonly resourceKind: ResourceKind;
}

/**
 * Terminal event for a successful create op. The `resourceKind` discriminator
 * narrows `outputs` to the matching `ResourceOutputs<K>` shape so renderers
 * can read Roblox-assigned IDs without casts.
 *
 * @since 0.1.0
 */
export type ResourceOpSucceededCreateEvent = {
	[K in ResourceKind]: Readonly<{
		environment: string;
		key: ResourceKey;
		kind: "resourceOpSucceeded";
		opType: "create";
		outputs: ResourceOutputs<K>;
		resourceKind: K;
	}>;
}[ResourceKind];

/**
 * Terminal event for a successful update op. Carries the list of top-level
 * fields the diff flagged as changed so renderers can attribute the update.
 *
 * @since 0.1.0
 */
export interface ResourceOpSucceededUpdateEvent {
	/** User-supplied resource key. */
	readonly key: ResourceKey;
	/** Top-level field names whose values differed between desired and current. */
	readonly changedFields: ReadonlyArray<string>;
	/** Environment whose reconcile is running. */
	readonly environment: string;
	/** Discriminator tag. */
	readonly kind: "resourceOpSucceeded";
	/** Operation type. */
	readonly opType: "update";
	/** Resource-kind discriminator. */
	readonly resourceKind: ResourceKind;
}

/**
 * Terminal event for a successful non-noop op. Sub-discriminated by `opType`
 * so a renderer can extract `outputs` (creates) or `changedFields` (updates)
 * without losing type narrowing.
 *
 * @since 0.1.0
 */
export type ResourceOpSucceededEvent =
	| ResourceOpSucceededCreateEvent
	| ResourceOpSucceededUpdateEvent;

/**
 * Per-resource event emitted for each op the diff produced as a noop.
 * Noops never fire a `started`/terminal pair; this single event stands in
 * for the entire op so adapters can render a "unchanged" line.
 *
 * @since 0.1.0
 */
export interface ResourceOpNoopEvent {
	/** User-supplied resource key. */
	readonly key: ResourceKey;
	/** Environment whose reconcile is running. */
	readonly environment: string;
	/** Discriminator tag. */
	readonly kind: "resourceOpNoop";
	/** Resource-kind discriminator. */
	readonly resourceKind: ResourceKind;
}

/**
 * Terminal event for a failed non-noop op. Carries the {@link ApplyError}
 * so a renderer can delegate to the existing apply-cause diagnostic helper.
 *
 * @since 0.1.0
 */
export interface ResourceOpFailedEvent {
	/** User-supplied resource key. */
	readonly key: ResourceKey;
	/** Environment whose reconcile is running. */
	readonly environment: string;
	/** Apply error returned by `dispatchOp`. */
	readonly error: ApplyError;
	/** Discriminator tag. */
	readonly kind: "resourceOpFailed";
	/** Operation type that was being attempted. */
	readonly opType: "create" | "update";
	/** Resource-kind discriminator. */
	readonly resourceKind: ResourceKind;
}

/**
 * Aggregate footer event emitted after `applyOps` finishes (Phase 2 settled).
 * Fires unconditionally, including on partial failure; `durationMs` measures
 * apply time only (state-write time excluded).
 *
 * @since 0.1.0
 */
export interface ApplySummaryEvent {
	/** Count of successful create ops. */
	readonly created: number;
	/** Wall-clock duration between `applyOps` entry and Phase 2 resolution, in milliseconds. */
	readonly durationMs: number;
	/** Environment whose reconcile is running. */
	readonly environment: string;
	/** Count of failed ops (any opType). */
	readonly failed: number;
	/** Discriminator tag. */
	readonly kind: "applySummary";
	/** Count of noop ops. */
	readonly noop: number;
	/** Count of successful update ops. */
	readonly updated: number;
}

/**
 * Per-environment event emitted after `statePort.write` returns `Ok`.
 * Not emitted on write failure: the existing `deployFailure` event with
 * `kind: "stateWriteFailed"` runs the existing failure flow. The payload
 * carries no backend identity; renderers read the backend label from the
 * project config when constructing the rendered line.
 *
 * @since 0.1.0
 */
export interface StateWrittenEvent {
	/** Environment whose state snapshot was just persisted. */
	readonly environment: string;
	/** Discriminator tag. */
	readonly kind: "stateWritten";
}

/**
 * Discriminated union of progress events the CLI emits while a deploy
 * runs. The variant set is additive: future per-stage and per-resource
 * events land as new `kind` values without breaking existing adapters.
 *
 * @since 0.1.0
 */
export type ProgressEvent =
	| ApplySummaryEvent
	| DeployFailureEvent
	| DeploySuccessEvent
	| ResourceOpFailedEvent
	| ResourceOpNoopEvent
	| ResourceOpStartedEvent
	| ResourceOpSucceededEvent
	| StateWrittenEvent;

/**
 * Plugin contract for receiving deploy outcomes: the interface an adapter
 * (clack renderer, JSON logger, custom UI) implements to let the CLI hand
 * off events without re-implementing rendering logic.
 *
 * `ProgressPort` is a *driven* (secondary) port in hexagonal terms.
 *
 * @since 0.1.0
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
