import type { Result } from "@bedrock-rbx/ocale";

import {
	badgeCreatesIn,
	type BadgeQuotaExceededError,
	checkBadgeCapacity,
	nextFreeBadgeQuotaReset,
} from "../core/capacity-check.ts";
import type { Operation } from "../core/operations.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";

/** Inputs to {@link checkCapacityAsync}. */
interface CapacityInputs {
	/** Every Operation the Diff produced. */
	readonly ops: ReadonlyArray<Operation>;
	/** Reads the free badge quota, when it can. */
	readonly quota: Pick<ResourceDriver<"badge">, "readCreateCapacity">;
}

/**
 * Run the **Capacity check** over a Diff. The free badge quota is read once,
 * and only when the Diff creates a badge. A read that fails, or no reader at
 * all, leaves the quota unknown.
 *
 * @param inputs - The Diff's Operations and the quota read.
 * @returns Success when the Deploy may proceed, or the refusal.
 */
export async function checkCapacityAsync({
	ops,
	quota,
}: CapacityInputs): Promise<Result<undefined, BadgeQuotaExceededError>> {
	const creates = badgeCreatesIn(ops);
	if (creates.length === 0) {
		return { data: undefined, success: true };
	}

	const read = await quota.readCreateCapacity?.();
	const checked = checkBadgeCapacity({
		allowDeferredCreates: false,
		creates,
		quota: read?.success === true ? read.data : undefined,
	});
	if (checked.kind !== "refuse") {
		return { data: undefined, success: true };
	}

	return {
		err: {
			available: checked.available,
			...(read?.success === false ? { cause: read.err } : {}),
			kind: "badgeQuotaExceeded",
			needed: checked.needed,
			resetsAt: nextFreeBadgeQuotaReset(new Date()),
		},
		success: false,
	};
}
