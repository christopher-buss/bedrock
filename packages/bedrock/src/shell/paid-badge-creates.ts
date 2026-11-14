import {
	ApiError,
	BadgeCostMismatchError,
	BadgeGroupSpendPermissionError,
	BadgeInsufficientFundsError,
	type OpenCloudError,
	type Result,
} from "@bedrock-rbx/ocale";

import { BadgePaymentStoppedError } from "../core/badge-payment-stop.ts";
import { inKeyOrder } from "../core/capacity-check.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import { UnconfirmedPaidCreateError } from "../core/unconfirmed-paid-create.ts";
import type { ResourceApplyContext, ResourceDriver } from "../ports/resource-driver.ts";
import type { ResourceKey } from "../types/ids.ts";
import type { SpendPlan } from "./check-capacity.ts";

/** What the **Paid creates** of a Deploy spent. */
export interface BadgeSpend {
	/** Keys of the badges created as Paid creates, in Key order. */
	readonly paid: ReadonlyArray<ResourceKey>;
	/** Robux spent on them. */
	readonly robux: number;
}

/** A badge Driver that pays within a Spend limit, and what it spent. */
export interface PayingBadgeDriver {
	/** The wrapped Driver. */
	readonly driver: BadgeDriver;
	/** Reads what the Driver's creates have spent so far. */
	readonly spent: () => BadgeSpend;
}

type BadgeDriver = ResourceDriver<"badge">;
type Created = Result<ResourceCurrentState<"badge">, OpenCloudError>;

/** The spending of one Deploy, shared by its paid sends. */
interface Spending extends SpendPlan {
	/** The wrapped Driver that sends the creates. */
	readonly driver: BadgeDriver;
	/** Keys of the badges paid for so far. */
	readonly paid: Array<{ readonly key: ResourceKey }>;
	/** The payment error that stopped spending, once one has. */
	stoppedBy: OpenCloudError | undefined;
}

/** A create Roblox refused for cost when it was sent free. */
interface RefusedCreate {
	readonly context: ResourceApplyContext | undefined;
	readonly desired: Parameters<BadgeDriver["create"]>[0];
	readonly refusal: BadgeCostMismatchError;
}

/**
 * Wrap a badge Driver so a create Roblox refuses for cost is sent once more
 * at the live price, while the Robux spent stays within the Spend limit.
 * Every create is sent free first, so a free create is never paid for. Paid
 * sends go out one at a time. The first paid send that fails for a payment
 * reason stops spending: every later create Roblox refuses for cost returns
 * a {@link BadgePaymentStoppedError} without a paid send. A price of 0 or
 * less is never paid.
 *
 * @param driver - The badge Driver to wrap.
 * @param plan - The Spend limit and the live price.
 * @returns The paying Driver and a reader of what it spent.
 */
export function paidBadgeCreates(driver: BadgeDriver, plan: SpendPlan): PayingBadgeDriver {
	const spending: Spending = { ...plan, driver, paid: [], stoppedBy: undefined };
	let previous: Promise<unknown> = Promise.resolve();
	return {
		driver: {
			...driver,
			create: async (desired, context) => {
				const free = await driver.create(desired, context);
				if (free.success || !(free.err instanceof BadgeCostMismatchError)) {
					return free;
				}

				const refused = { context, desired, refusal: free.err };
				const turn = previous.then(async () => payAsync(spending, refused));
				previous = Promise.allSettled([turn]);
				return turn;
			},
		},
		spent: () => {
			return {
				paid: inKeyOrder(spending.paid).map(({ key }) => key),
				robux: spending.paid.length * spending.price,
			};
		},
	};
}

/**
 * Mark a server error on a paid send as one that may have charged.
 *
 * @param err - Why the paid send failed.
 * @param price - The Robux the paid send offered.
 * @returns A {@link UnconfirmedPaidCreateError} for a server error, or
 *   `err` itself.
 */
function paidSendFailure(err: OpenCloudError, price: number): OpenCloudError {
	return err instanceof ApiError && err.statusCode >= 500
		? new UnconfirmedPaidCreateError(err, price)
		: err;
}

function stopsSpending(err: OpenCloudError): boolean {
	return (
		err instanceof BadgeInsufficientFundsError ||
		err instanceof BadgeGroupSpendPermissionError ||
		err instanceof UnconfirmedPaidCreateError
	);
}

async function payAsync(
	spending: Spending,
	{ context, desired, refusal }: RefusedCreate,
): Promise<Created> {
	if (spending.stoppedBy !== undefined) {
		return { err: new BadgePaymentStoppedError(refusal, spending.stoppedBy), success: false };
	}

	if (spending.price <= 0 || (spending.paid.length + 1) * spending.price > spending.limit) {
		return { err: refusal, success: false };
	}

	const charged = await spending.driver.create(desired, {
		...context,
		expectedCost: spending.price,
	});
	if (charged.success) {
		spending.paid.push({ key: desired.key });
		return charged;
	}

	const err = paidSendFailure(charged.err, spending.price);
	if (stopsSpending(err)) {
		spending.stoppedBy = err;
	}

	return { err, success: false };
}
