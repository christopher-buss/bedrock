import { BadgeCostMismatchError, type Result } from "@bedrock-rbx/ocale";

import type { DeferredCreate } from "../core/capacity-check.ts";
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

	const [first, ...rest] = applied.err.failures.filter((failure) => !isFreeQuotaRefusal(failure));
	if (first === undefined) {
		onDeferred(applied.err.failures.map(({ key }): DeferredCreate => ({ key, kind: "badge" })));
		return { data: applied.err.applied, success: true };
	}

	return { err: { ...applied.err, failures: [first, ...rest] }, success: false };
}

function isFreeQuotaRefusal(failure: ApplyError): boolean {
	return Reflect.get(failure, "cause") instanceof BadgeCostMismatchError;
}
