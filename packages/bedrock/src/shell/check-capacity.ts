import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";

import {
	badgeCreatesIn,
	type BadgeQuotaExceededError,
	checkBadgeCapacity,
	nextFreeBadgeQuotaReset,
} from "../core/capacity-check.ts";
import type { Operation } from "../core/operations.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";

/** Reads the free badge quota, when it can. */
export type FreeBadgeQuota = Pick<ResourceDriver<"badge">, "readCreateCapacity">;

/** Inputs to {@link checkCapacityAsync}. */
interface CapacityInputs {
	/** Every Operation the Diff produced. */
	readonly ops: ReadonlyArray<Operation>;
	/** Reads the free badge quota, when it can. */
	readonly quota: FreeBadgeQuota;
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

/**
 * Pick how a run without a badge Driver reads the free badge quota: the
 * caller's read when given, else the unauthenticated Roblox read for
 * the config's `universe.universeId`. With neither, the quota is unknown.
 *
 * @param read - The caller's quota read, if any.
 * @param config - The resolved config naming the universe, if declared.
 * @returns The quota read to run the **Capacity check** with.
 */
export function freeBadgeQuotaOf(
	read: (() => Promise<Result<number, OpenCloudError>>) | undefined,
	config: ResolvedConfig,
): FreeBadgeQuota {
	if (read !== undefined) {
		return { readCreateCapacity: read };
	}

	const universeId = config.universe?.universeId;
	if (universeId === undefined) {
		return {};
	}

	const client = new BadgesClient({ credential: { kind: "none" } });
	return { readCreateCapacity: async () => client.getFreeQuota({ universeId }) };
}
