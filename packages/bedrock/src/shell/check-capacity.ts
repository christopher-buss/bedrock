import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";

import {
	badgeCreatesIn,
	type BadgeQuotaExceededError,
	type CapacityCheck,
	checkBadgeCapacity,
	deferredBadge,
	type DeferredCreate,
	inKeyOrder,
	needsCreationPrice,
	nextFreeBadgeQuotaReset,
} from "../core/capacity-check.ts";
import type { CreateOperation, Operation } from "../core/operations.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import type { ResourceKey } from "../types/ids.ts";

/**
 * Reads the free badge quota and the price of a **Paid create**, when it
 * can.
 */
export type FreeBadgeQuota = Pick<
	ResourceDriver<"badge">,
	"readCreateCapacity" | "readCreatePrice"
>;

/**
 * What a Deploy may spend on **Paid creates**: Apply re-sends a create Roblox
 * refuses for cost once at `price`, while the Robux spent stays within
 * `limit`.
 */
export interface SpendPlan {
	/** The Spend limit in effect, in Robux. */
	readonly limit: number;
	/** The live price of one Paid create, in Robux. */
	readonly price: number;
}

/**
 * What the **Capacity check** lets Apply run: badge creates in parallel,
 * without the Deferred creates and paying within a Spend limit when one is
 * planned, or, when the free badge quota is unknown, one at a time in Key
 * order.
 */
export type CapacityPlan =
	| {
			/** Badge creates run one at a time. */
			readonly mode: "serial";
			/** The Keys of the badge creates, in the Key order they run in. */
			readonly order: ReadonlyArray<ResourceKey>;
	  }
	| {
			/** The Deferred creates, in Key order. */
			readonly deferred: ReadonlyArray<DeferredCreate>;
			/** Badge creates run in parallel. */
			readonly mode: "parallel";
			/** What the creates may spend, absent when none is paid for. */
			readonly spend?: SpendPlan;
	  };

/** Inputs to {@link checkCapacityAsync}. */
interface CapacityInputs {
	/** Whether the Environment lets a shortfall become Deferred creates. */
	readonly allowDeferredCreates: boolean;
	/** Every Operation the Diff produced. */
	readonly ops: ReadonlyArray<Operation>;
	/** Reads the free badge quota and the creation price, when it can. */
	readonly quota: FreeBadgeQuota;
	/** Robux the Deploy may spend on Paid creates; `0` spends nothing. */
	readonly spendLimit?: number;
}

/**
 * Run the **Capacity check** over a Diff. The free badge quota is read once,
 * and only when the Diff creates a badge. A read that fails, or no reader at
 * all, leaves the quota unknown. The price of a **Paid create** is read only
 * when a Spend limit could cover a shortfall; an unread price refuses.
 *
 * @param inputs - The Diff's Operations, the deferral setting, the Spend
 *   limit, and the quota and price reads.
 * @returns What Apply may run, or the refusal.
 */
export async function checkCapacityAsync({
	allowDeferredCreates,
	ops,
	quota,
	spendLimit = 0,
}: CapacityInputs): Promise<Result<CapacityPlan, BadgeQuotaExceededError>> {
	const creates = badgeCreatesIn(ops);
	if (creates.length === 0) {
		return { data: { deferred: [], mode: "parallel" }, success: true };
	}

	const read = await quota.readCreateCapacity?.();
	const known = read?.success === true ? read.data : undefined;
	const priced = needsCreationPrice({ allowDeferredCreates, creates, quota: known, spendLimit })
		? await quota.readCreatePrice?.()
		: undefined;
	const checked = checkBadgeCapacity({
		allowDeferredCreates,
		creates,
		price: priced?.success === true ? priced.data : undefined,
		quota: known,
		spendLimit,
	});
	if (checked.kind !== "refuse") {
		return { data: planOf(checked, { creates, spendLimit }), success: true };
	}

	return { err: refusalOf(checked, [read, priced]), success: false };
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

function refusalOf(
	{ available, needed, spend }: Extract<CapacityCheck, { readonly kind: "refuse" }>,
	reads: ReadonlyArray<Result<number, OpenCloudError> | undefined>,
): BadgeQuotaExceededError {
	const failed = reads.find((read) => read?.success === false);
	return {
		available,
		...(failed?.success === false ? { cause: failed.err } : {}),
		kind: "badgeQuotaExceeded",
		needed,
		resetsAt: nextFreeBadgeQuotaReset(new Date()),
		...(spend === undefined ? {} : { spend }),
	};
}

function planOf(
	checked: Exclude<CapacityCheck, { readonly kind: "refuse" }>,
	{
		creates,
		spendLimit,
	}: { readonly creates: ReadonlyArray<CreateOperation>; readonly spendLimit: number },
): CapacityPlan {
	if (checked.kind === "serial") {
		return { mode: "serial", order: inKeyOrder(creates).map(({ key }) => key) };
	}

	if (checked.kind === "pay") {
		return {
			deferred: [],
			mode: "parallel",
			spend: { limit: spendLimit, price: checked.price },
		};
	}

	const deferred = checked.kind === "defer" ? checked.deferred : [];
	return { deferred: deferred.map(({ key }) => deferredBadge(key)), mode: "parallel" };
}
