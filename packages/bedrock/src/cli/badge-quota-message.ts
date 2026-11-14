import type { BadgeQuotaExceededError } from "../core/capacity-check.ts";
import { spendQuoteCost } from "./spend-quote.ts";

/**
 * Describe a **Capacity check** refusal by the badge creates it needs, the
 * free badges left, the Robux Paid creates would need over the Spend limit,
 * and when the free badge quota resets.
 *
 * @param err - The refusal to describe.
 * @returns The message to print.
 */
export function badgeQuotaMessage(err: BadgeQuotaExceededError): string {
	const reset = `the free badge quota resets at ${err.resetsAt.toISOString().slice(0, 10)} 00:00 UTC`;
	const needed = `${err.needed} badge ${err.needed === 1 ? "create" : "creates"}`;
	if (err.available === undefined) {
		const reason =
			err.cause?.message ??
			"no universe.universeId is declared, or the badge driver has no quota read";
		return `deploy refused: ${needed} needed, but the free badge quota could not be read: ${reason}; ${worstCase(err)}${reset}`;
	}

	return `deploy refused: ${needed} needed, ${err.available} free left today; ${spendReason(err, err.available)}${reset}`;
}

function overLimit({
	limit,
	robux,
	shortfall,
}: {
	readonly limit: number;
	readonly robux: number;
	readonly shortfall: number;
}): string {
	return `paying for the other ${shortfall} needs ${robux} Robux, over the spend limit of ${limit} Robux; `;
}

function spendReason(
	{ cause, needed, spend, spendQuote }: BadgeQuotaExceededError,
	available: number,
): string {
	const shortfall = needed - available;
	if (spend !== undefined) {
		return overLimit({ limit: spend.limit, robux: spend.needed, shortfall });
	}

	if (spendQuote !== undefined) {
		return spendQuote.paid < shortfall
			? overLimit({ limit: spendQuote.limit, robux: shortfall * spendQuote.price, shortfall })
			: `--allow-spend pays for the other ${shortfall}: ${spendQuoteCost(spendQuote)}; `;
	}

	return cause === undefined
		? ""
		: `the badge creation price could not be read: ${cause.message}; `;
}

function worstCase({ needed, spend, spendQuote }: BadgeQuotaExceededError): string {
	const quote = spend ?? spendQuote;
	if (quote === undefined) {
		return "";
	}

	if (spendQuote?.paid === needed) {
		return `--allow-spend pays for all ${needed}: ${spendQuoteCost(spendQuote)}; `;
	}

	return `paying for all ${needed} at ${quote.price} Robux each needs ${needed * quote.price} Robux, over the spend limit of ${quote.limit} Robux; `;
}
