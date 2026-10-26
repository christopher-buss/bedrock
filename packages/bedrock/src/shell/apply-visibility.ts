import { OpenCloudError, type Result } from "@bedrock-rbx/ocale";

import type { Operation } from "../core/operations.ts";
import { type ResourceCurrentState, UNIVERSE_SINGLETON_KEY } from "../core/resources.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { ResourceKey } from "../types/ids.ts";
import type { AggregateApplyError, ApplyError, ApplyOpsReporting } from "./apply-ops.ts";
import {
	reportVisibilityFinished,
	reportVisibilityStarted,
} from "./report-visibility-transition.ts";

/** Visibility-specific outcome for a caller that owns State persistence. */
export interface VisibilityOutcome {
	/**
	 * Whether the transition succeeded, has an unknown outcome, or was
	 * withheld.
	 */
	readonly status: "confirmed" | "deferred" | "unresolved";
	/** Requested public/private classification. */
	readonly target: "private" | "public";
	/** Universe this transition belongs to. */
	readonly universeId: string;
}

type ApplyResult = Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>;
type LiveOp = Extract<Operation, { readonly type: "create" | "update" }>;

type TransitionOp = LiveOp & {
	readonly desired: Extract<
		LiveOp["desired"],
		{ kind: "universe" }
	> & { readonly visibility: "private" | "public" };
};
interface Batch {
	readonly ops: ReadonlyArray<Operation>;
	readonly ordinary: (
		ops: ReadonlyArray<Operation>,
		reporting?: ApplyOpsReporting,
	) => Promise<ApplyResult>;
	readonly registry: DriverRegistry;
	readonly reporting?: ApplyOpsReporting | undefined;
}
interface Outcome {
	applied: Array<ResourceCurrentState>;
	readonly failedResources: Set<string>;
	readonly failures: Array<ApplyError>;
	readonly visibility: Array<VisibilityOutcome>;
	untracked: number;
}
interface Completion {
	readonly batch: Batch;
	readonly start: number;
}
interface TransitionInputs {
	readonly op: TransitionOp;
	readonly outcome: Outcome;
	readonly registry: DriverRegistry;
	readonly reporting?: ApplyOpsReporting | undefined;
}

interface TransitionRequest {
	readonly key?: ResourceKey | undefined;
	readonly reporting?: ApplyOpsReporting | undefined;
	readonly target: "private" | "public";
	readonly universeId: string;
}
/**
 * Invoke a universe driver's transition capability without retrying ambiguity.
 *
 * @param registry - The configured driven adapters.
 * @param transition - Universe identity and requested classification.
 * @returns A confirmed success or the driver's unconfirmed error.
 */
export async function transitionAsync(
	registry: DriverRegistry,
	transition: TransitionRequest,
): Promise<Result<undefined, OpenCloudError>> {
	const reporting = {
		key: transition.key ?? UNIVERSE_SINGLETON_KEY,
		reporting: transition.reporting,
	};
	reportVisibilityStarted(reporting);

	const result = await invokeTransitionAsync(registry, transition);
	reportVisibilityFinished({ ...reporting, result });
	return result;
}

/**
 * Order visibility around the supplied batch, leaving persistence to its
 * caller.
 *
 * @param batch - Operations, driven adapters, and ordinary resource dispatcher.
 * @returns Confirmed resources, or truthful partial and visibility outcomes.
 */
export async function applyWithVisibilityAsync(batch: Batch): Promise<ApplyResult> {
	const transitions = batch.ops.filter(isTransition);
	if (transitions.length === 0) {
		return batch.ordinary(batch.ops, batch.reporting);
	}

	const completion = { batch, start: Date.now() };
	const outcome: Outcome = {
		applied: [],
		failedResources: new Set(),
		failures: [],
		visibility: [],
		untracked: 0,
	};
	for (const op of transitions) {
		if (
			op.desired.visibility === "private" &&
			!(await applyTransitionAsync({ ...batch, op, outcome }))
		) {
			return resultOf(outcome, completion);
		}
	}

	await applyOrdinaryAsync(batch, outcome);

	for (const op of transitions) {
		await finishTransitionAsync({ ...batch, op, outcome });
	}

	return resultOf(outcome, completion);
}

async function invokeTransitionAsync(
	registry: DriverRegistry,
	transition: TransitionRequest,
): Promise<Result<undefined, OpenCloudError>> {
	try {
		return registry.universe.setVisibility === undefined
			? {
					err: new OpenCloudError(
						"The universe driver does not support visibility transitions",
					),
					success: false,
				}
			: await registry.universe.setVisibility(transition.universeId, transition.target);
	} catch (err) {
		return {
			err: new OpenCloudError("Universe visibility transition threw", { cause: err }),
			success: false,
		};
	}
}

function withoutSummary(
	reporting: ApplyOpsReporting | undefined,
	outcome: Outcome,
): ApplyOpsReporting | undefined {
	return reporting === undefined
		? undefined
		: {
				environment: reporting.environment,
				progress: {
					emit(event) {
						if (event.kind === "resourceOpFailed") {
							outcome.failedResources.add(`${event.resourceKind}:${event.key}`);
						}

						if (event.kind !== "applySummary") {
							reporting.progress.emit(event);
						}
					},
				},
			};
}

function withoutVisibility(op: Operation): Operation {
	if ((op.type !== "create" && op.type !== "update") || op.desired.kind !== "universe") {
		return op;
	}

	const { visibility: _visibility, ...desired } = op.desired;
	return { ...op, desired };
}

async function applyOrdinaryAsync(batch: Batch, outcome: Outcome): Promise<void> {
	const ordinary = await batch.ordinary(
		batch.ops.map(withoutVisibility),
		withoutSummary(batch.reporting, outcome),
	);
	outcome.untracked = batch.ops.filter((op) => op.type === "untrack").length;
	outcome.applied = [...(ordinary.success ? ordinary.data : ordinary.err.applied)];
	if (!ordinary.success) {
		outcome.failures.push(...ordinary.err.failures);
	}
}

function isTransition(op: Operation): op is TransitionOp {
	return (
		(op.type === "create" || op.type === "update") &&
		op.desired.kind === "universe" &&
		op.desired.visibility !== undefined &&
		(op.type === "create" || op.changedFields.includes("visibility"))
	);
}

async function applyTransitionAsync({
	op,
	outcome,
	registry,
	reporting,
}: TransitionInputs): Promise<boolean> {
	const changed = await transitionAsync(registry, {
		key: op.key,
		reporting,
		target: op.desired.visibility,
		universeId: op.desired.universeId,
	});
	outcome.visibility.push({
		status: changed.success ? "confirmed" : "unresolved",
		target: op.desired.visibility,
		universeId: op.desired.universeId,
	});
	if (!changed.success) {
		outcome.failedResources.add(`universe:${op.key}`);
		outcome.failures.push({ key: op.key, cause: changed.err, kind: "driverFailure" });
	}

	return changed.success;
}

function confirmResource(op: TransitionOp, outcome: Outcome): void {
	outcome.applied = outcome.applied.map((resource) => {
		return resource.kind === "universe" && resource.universeId === op.desired.universeId
			? { ...resource, visibility: op.desired.visibility }
			: resource;
	});
	const exists = outcome.applied.some(
		(resource) => resource.kind === "universe" && resource.universeId === op.desired.universeId,
	);
	if (
		!exists &&
		op.type === "update" &&
		op.current.kind === "universe" &&
		op.current.universeId === op.desired.universeId
	) {
		outcome.applied.push({ ...op.current, visibility: op.desired.visibility });
	}
}

async function finishTransitionAsync({
	op,
	outcome,
	registry,
	reporting,
}: TransitionInputs): Promise<void> {
	if (op.desired.visibility === "public") {
		if (outcome.failures.length > 0) {
			outcome.visibility.push({
				status: "deferred",
				target: "public",
				universeId: op.desired.universeId,
			});
			return;
		}

		if (!(await applyTransitionAsync({ op, outcome, registry, reporting }))) {
			return;
		}
	}

	confirmResource(op, outcome);
}

function emitSummary(outcome: Outcome, { batch, start }: Completion): void {
	if (batch.reporting === undefined) {
		return;
	}

	const applied = new Set(outcome.applied.map((resource) => `${resource.kind}:${resource.key}`));
	const completed = batch.ops.filter((op) => {
		return (
			(op.type === "create" || op.type === "update") &&
			!outcome.failedResources.has(`${op.desired.kind}:${op.key}`) &&
			applied.has(`${op.desired.kind}:${op.key}`)
		);
	});
	batch.reporting.progress.emit({
		created: completed.filter((op) => op.type === "create").length,
		durationMs: Date.now() - start,
		environment: batch.reporting.environment,
		failed: outcome.failures.length,
		kind: "applySummary",
		noop: batch.ops.filter((op) => op.type === "noop").length,
		untracked: outcome.untracked,
		updated: completed.filter((op) => op.type === "update").length,
	});
}

function resultOf(outcome: Outcome, completion: Completion): ApplyResult {
	emitSummary(outcome, completion);
	const [head, ...tail] = outcome.failures;
	return head === undefined
		? { data: outcome.applied, success: true }
		: {
				err: {
					applied: outcome.applied,
					failures: [head, ...tail],
					visibility: outcome.visibility,
				},
				success: false,
			};
}
