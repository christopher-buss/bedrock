import { BadgeCostMismatchError } from "@bedrock-rbx/ocale";

import { inKeyOrder } from "../core/capacity-check.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
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

/**
 * Wrap a badge Driver so a create Roblox refuses for cost is sent once more
 * at the live price, while the Robux spent stays within the Spend limit.
 * Every create is sent free first, so a free create is never paid for. A
 * paid send reserves its price before it goes out, so parallel creates
 * cannot together pass the limit, and returns the reservation when Roblox
 * refuses it.
 *
 * @param driver - The badge Driver to wrap.
 * @param plan - The Spend limit and the live price.
 * @returns The paying Driver and a reader of what it spent.
 */
export function paidBadgeCreates(
	driver: BadgeDriver,
	{ limit, price }: SpendPlan,
): PayingBadgeDriver {
	const paid: Array<{ readonly key: ResourceKey }> = [];
	let reserved = 0;
	return {
		driver: {
			...driver,
			create: async (desired, context) => {
				const free = await driver.create(desired, context);
				if (free.success || !(free.err instanceof BadgeCostMismatchError)) {
					return free;
				}

				if (reserved + price > limit) {
					return free;
				}

				reserved += price;
				const charged = await driver.create(desired, { ...context, expectedCost: price });
				if (charged.success) {
					paid.push({ key: desired.key });
				} else {
					reserved -= price;
				}

				return charged;
			},
		},
		spent: () => ({ paid: inKeyOrder(paid).map(({ key }) => key), robux: paid.length * price }),
	};
}
