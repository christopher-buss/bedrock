import type { BadgeQuotaExceededError } from "../core/capacity-check.ts";

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
		return `deploy refused: ${needed} needed, but the free badge quota could not be read: ${reason}; ${reset}`;
	}

	return `deploy refused: ${needed} needed, ${err.available} free left today; ${spendReason(err, err.available)}${reset}`;
}

function spendReason({ cause, needed, spend }: BadgeQuotaExceededError, available: number): string {
	if (spend !== undefined) {
		return `paying for the other ${needed - available} needs ${spend.needed} Robux, over the spend limit of ${spend.limit} Robux; `;
	}

	return cause === undefined
		? ""
		: `the badge creation price could not be read: ${cause.message}; `;
}
