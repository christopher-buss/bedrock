import { BadgeCostMismatchError, type Result } from "@bedrock-rbx/ocale";

import { deferredBadge, type DeferredCreate } from "../core/capacity-check.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { BedrockState } from "../core/state.ts";
import type { ProgressPort } from "../ports/progress-port.ts";
import type { AggregateApplyError, ApplyError } from "./apply-ops.ts";
import type { DeployError, ReconcileOutcome } from "./deploy.ts";

type Applied = Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>;

/** An Apply outcome plus the badge creates it deferred. */
interface Deferring {
	/** What Apply returned, without the deferred creates' failures. */
	readonly applied: Applied;
	/** The badge creates Roblox refused for cost, in failure order. */
	readonly deferred: ReadonlyArray<DeferredCreate>;
}

/**
 * Turn the badge creates Roblox refused for cost, because the free badge
 * quota ran out after the **Capacity check**, into **Deferred creates**.
 *
 * @param applied - What Apply returned.
 * @param allowed - Whether the Environment allows Deferred creates; when
 *   not, the refusals stay failures.
 * @returns The Apply outcome without the deferred creates' failures, and the
 *   deferred creates, whether or not other failures remain.
 */
export function deferCostRefusals(applied: Applied, allowed: boolean): Deferring {
	if (!allowed || applied.success) {
		return { applied, deferred: [] };
	}

	const deferred = applied.err.failures
		.filter(isCostRefusal)
		.map(({ key }) => deferredBadge(key));
	const others = applied.err.failures.filter((failure) => !isCostRefusal(failure));
	return {
		applied: hasFailures(others)
			? { err: { ...applied.err, failures: others }, success: false }
			: { data: applied.err.applied, success: true },
		deferred,
	};
}

/**
 * Carry a runner's Deferred creates over to the outcome a stage builds from
 * its result, leaving an outcome with none untouched.
 *
 * @param outcome - What the stage returns.
 * @param deferred - The creates the runner deferred, if it reported any.
 * @returns The outcome, beside the deferred creates when there are any.
 */
export function withDeferred(
	outcome: Result<BedrockState, DeployError>,
	deferred: ReadonlyArray<DeferredCreate> | undefined,
): ReconcileOutcome {
	return deferred === undefined ? outcome : { ...outcome, deferred };
}

/**
 * Wrap a progress port so a create Roblox refuses for cost is not reported
 * as failed: its `resourceOpFailed` event is dropped and the `applySummary`
 * that follows does not count it.
 *
 * @param progress - The progress port to wrap.
 * @returns The wrapped port.
 */
export function withoutCostRefusalFailures(progress: ProgressPort): ProgressPort {
	let refused = 0;
	return {
		emit(event) {
			if (event.kind === "resourceOpFailed" && isCostRefusal(event.error)) {
				refused += 1;
				return;
			}

			progress.emit(
				event.kind === "applySummary"
					? { ...event, failed: event.failed - refused }
					: event,
			);
		},
	};
}

/**
 * Whether Roblox refused an Apply failure's create for cost, because the free
 * badge quota ran out.
 *
 * @param failure - The Apply failure.
 * @returns `true` when the Driver returned a `BadgeCostMismatchError`.
 */
function isCostRefusal(failure: ApplyError): boolean {
	return failure.kind === "driverFailure" && failure.cause instanceof BadgeCostMismatchError;
}

function hasFailures(
	failures: ReadonlyArray<ApplyError>,
): failures is AggregateApplyError["failures"] {
	return failures.length > 0;
}
