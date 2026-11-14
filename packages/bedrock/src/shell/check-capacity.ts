import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";

import {
	badgeCreatesIn,
	type BadgeQuotaExceededError,
	type BadgeSpendQuote,
	type CapacityCheck,
	checkBadgeCapacity,
	deferredBadge,
	type DeferredCreate,
	inKeyOrder,
	needsCreationPrice,
	needsSpendQuote,
	nextFreeBadgeQuotaReset,
	quoteBadgeSpend,
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
 * without the Deferred creates, or, when the free badge quota is unknown, one
 * at a time in Key order. Either way the creates pay within a Spend limit
 * when one is planned.
 */
export type CapacityPlan =
	| {
			/** Badge creates run one at a time. */
			readonly mode: "serial";
			/** The Keys of the badge creates, in the Key order they run in. */
			readonly order: ReadonlyArray<ResourceKey>;
			/** What the creates may spend, absent when none is paid for. */
			readonly spend?: SpendPlan;
	  }
	| {
			/** The Deferred creates, in Key order. */
			readonly deferred: ReadonlyArray<DeferredCreate>;
			/** Badge creates run in parallel. */
			readonly mode: "parallel";
			/** What the creates may spend, absent when none is paid for. */
			readonly spend?: SpendPlan;
			/**
			 * What the Paid creates cost, or, without spend approval, what
			 * `--allow-spend` would pay for the Deferred creates; absent
			 * without a shortfall or a Spend limit.
			 */
			readonly spendQuote?: BadgeSpendQuote;
	  };

/** A read of a number from Roblox: the free badge quota or a price. */
type QuotaRead = () => Promise<Result<number, OpenCloudError>>;

/** Inputs to {@link checkCapacityAsync}. */
interface CapacityInputs {
	/** Whether the Environment lets a shortfall become Deferred creates. */
	readonly allowDeferredCreates: boolean;
	/**
	 * The Environment's Spend limit, quoted in reports whether or not the run
	 * gave spend approval; `0` quotes nothing.
	 */
	readonly configuredSpendLimit?: number;
	/** Every Operation the Diff produced. */
	readonly ops: ReadonlyArray<Operation>;
	/** Reads the free badge quota and the creation price, when it can. */
	readonly quota: FreeBadgeQuota;
	/** Robux the Deploy may spend on Paid creates; `0` spends nothing. */
	readonly spendLimit?: number;
}

/** The price read for a known shortfall, and what it quotes. */
interface ShortfallPricing {
	/** The price read, when the **Capacity check** decides on it. */
	readonly decisive?: Result<number, OpenCloudError> | undefined;
	/** The live price of one Paid create, when it was read. */
	readonly price?: number | undefined;
	/** What the Paid creates cost, or would cost with spend approval. */
	readonly spendQuote?: BadgeSpendQuote | undefined;
}

const UNPRICED: ShortfallPricing = {};

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
	configuredSpendLimit = 0,
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
	const inputs = { allowDeferredCreates, configuredSpendLimit, creates, spendLimit };
	const pricing = await priceShortfallAsync(quota, { ...inputs, known });
	const checked = checkBadgeCapacity({ ...inputs, price: pricing.price, quota: known });
	return checked.kind === "refuse"
		? {
				err: refusalOf(checked, {
					reads: [read, pricing.decisive],
					spendQuote: pricing.spendQuote,
				}),
				success: false,
			}
		: {
				data: planOf(checked, { creates, spendLimit, spendQuote: pricing.spendQuote }),
				success: true,
			};
}

/**
 * Pick how a run without a badge Driver reads the free badge quota and the
 * price of a **Paid create**: the caller's reads when given, else the
 * unauthenticated Roblox reads. The quota read needs the config's
 * `universe.universeId`; without it the quota is unknown.
 *
 * @param reads - The caller's quota and price reads, if any.
 * @param config - The resolved config naming the universe, if declared.
 * @returns The reads to run the **Capacity check** with.
 */
export function freeBadgeQuotaOf(
	{
		readBadgeCreationPrice,
		readFreeBadgeQuota,
	}: {
		readonly readBadgeCreationPrice?: QuotaRead | undefined;
		readonly readFreeBadgeQuota?: QuotaRead | undefined;
	},
	config: ResolvedConfig,
): FreeBadgeQuota {
	const client = new BadgesClient({ credential: { kind: "none" } });
	const readCreatePrice = readBadgeCreationPrice ?? (async () => client.getCreationPrice());
	if (readFreeBadgeQuota !== undefined) {
		return { readCreateCapacity: readFreeBadgeQuota, readCreatePrice };
	}

	const universeId = config.universe?.universeId;
	if (universeId === undefined) {
		return {};
	}

	return {
		readCreateCapacity: async () => client.getFreeQuota({ universeId }),
		readCreatePrice,
	};
}

/**
 * Read the price of a **Paid create** when the **Capacity check** decides on
 * it, or, without spend approval, when a report quotes it.
 *
 * @param quota - Reads the creation price.
 * @param inputs - The badge creates, the known quota, the deferral setting,
 *   and the Spend limits.
 * @returns The price, its read when decisive, and the quote.
 */
async function priceShortfallAsync(
	quota: FreeBadgeQuota,
	{
		allowDeferredCreates,
		configuredSpendLimit,
		creates,
		known,
		spendLimit,
	}: {
		readonly allowDeferredCreates: boolean;
		readonly configuredSpendLimit: number;
		readonly creates: ReadonlyArray<CreateOperation>;
		readonly known: number | undefined;
		readonly spendLimit: number;
	},
): Promise<ShortfallPricing> {
	const decides = needsCreationPrice({ allowDeferredCreates, creates, quota: known, spendLimit });
	const quotes =
		spendLimit === 0 &&
		needsSpendQuote({ creates, quota: known, spendLimit: configuredSpendLimit });
	if (!decides && !quotes) {
		return UNPRICED;
	}

	const priced = await quota.readCreatePrice?.();
	const decisive = decides ? priced : undefined;
	if (priced?.success !== true) {
		return { decisive };
	}

	const price = priced.data;
	return {
		decisive,
		price,
		...(quotes && known !== undefined
			? {
					spendQuote: quoteBadgeSpend({
						approved: false,
						limit: configuredSpendLimit,
						price,
						shortfall: creates.length - known,
					}),
				}
			: {}),
	};
}

function refusalOf(
	{ available, needed, spend }: Extract<CapacityCheck, { readonly kind: "refuse" }>,
	{
		reads,
		spendQuote,
	}: {
		readonly reads: ReadonlyArray<Result<number, OpenCloudError> | undefined>;
		readonly spendQuote: BadgeSpendQuote | undefined;
	},
): BadgeQuotaExceededError {
	const failed = reads.find((read) => read?.success === false);
	return {
		available,
		...(failed?.success === false ? { cause: failed.err } : {}),
		kind: "badgeQuotaExceeded",
		needed,
		resetsAt: nextFreeBadgeQuotaReset(new Date()),
		...(spend === undefined ? {} : { spend }),
		...(spendQuote === undefined ? {} : { spendQuote }),
	};
}

function planOf(
	checked: Exclude<CapacityCheck, { readonly kind: "refuse" }>,
	{
		creates,
		spendLimit,
		spendQuote,
	}: {
		readonly creates: ReadonlyArray<CreateOperation>;
		readonly spendLimit: number;
		readonly spendQuote: BadgeSpendQuote | undefined;
	},
): CapacityPlan {
	if (checked.kind === "serial") {
		return {
			mode: "serial",
			order: inKeyOrder(creates).map(({ key }) => key),
			...(checked.price === undefined
				? {}
				: { spend: { limit: spendLimit, price: checked.price } }),
		};
	}

	const deferred = checked.kind === "proceed" ? [] : checked.deferred;
	return {
		deferred: deferred.map(({ key }) => deferredBadge(key)),
		mode: "parallel",
		...(checked.kind === "pay"
			? {
					spend: { limit: spendLimit, price: checked.price },
					spendQuote: {
						approved: true,
						limit: spendLimit,
						paid: checked.paid,
						price: checked.price,
					},
				}
			: {}),
		...(spendQuote === undefined ? {} : { spendQuote }),
	};
}
