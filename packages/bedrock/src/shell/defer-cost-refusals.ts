import { BadgeCostMismatchError, type Result } from "@bedrock-rbx/ocale";

import { deferredBadge, type DeferredCreate } from "../core/capacity-check.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { AggregateApplyError, ApplyError } from "./apply-ops.ts";

type Applied = Result<ReadonlyArray<ResourceCurrentState>, AggregateApplyError>;

/**
 * Turn the badge creates Roblox refused for cost, because the free badge
 * quota ran out after the **Capacity check**, into **Deferred creates**.
 *
 * @param applied - What Apply returned.
 * @param onDeferred - Receives the deferred creates when every failure is a
 *   cost refusal, the only case the run still succeeds; when absent, the
 *   refusals stay failures.
 * @returns The Apply outcome without the deferred creates' failures.
 */
export function deferCostRefusals(
	applied: Applied,
	onDeferred: ((deferred: ReadonlyArray<DeferredCreate>) => void) | undefined,
): Applied {
	if (onDeferred === undefined || applied.success) {
		return applied;
	}

	const others = applied.err.failures.filter((failure) => !isCostRefusal(failure));
	if (hasFailures(others)) {
		return { err: { ...applied.err, failures: others }, success: false };
	}

	onDeferred(applied.err.failures.map(({ key }) => deferredBadge(key)));
	return { data: applied.err.applied, success: true };
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
