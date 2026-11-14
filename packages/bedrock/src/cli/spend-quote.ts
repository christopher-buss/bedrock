import type { BadgeSpendQuote } from "../core/capacity-check.ts";

/**
 * Describe what the **Paid creates** of a quote cost against the Spend
 * limit.
 *
 * @param quote - The quote to describe.
 * @returns The price, the total, and the limit, in Robux.
 */
export function spendQuoteCost({
	limit,
	paid,
	price,
}: Pick<BadgeSpendQuote, "limit" | "paid" | "price">): string {
	return `${price} Robux each, ${paid * price} Robux of the ${limit} Robux spend limit`;
}
