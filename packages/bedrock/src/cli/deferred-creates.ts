import type { BadgeCreatesDeferredEvent } from "../ports/progress-port.ts";
import { spendQuoteCost } from "./spend-quote.ts";

/**
 * Render the warning for badge creates a Deploy left for a later Deploy.
 *
 * @param event - The deferred creates, their Environment, and the reset.
 * @returns One line naming the deferred Keys, the next quota reset, and,
 *   when the run gave no spend approval, what `--allow-spend` would pay for
 *   them.
 */
export function deferredCreatesLine(event: BadgeCreatesDeferredEvent): string {
	const count = event.deferred.length;
	const creates = `${count} badge ${count === 1 ? "create" : "creates"}`;
	const keys = event.deferred.map(({ key }) => key).join(", ");
	const reset = event.resetsAt.toISOString().slice(0, 10);
	const quote = event.spendQuote;
	const spend =
		quote === undefined || quote.approved || quote.paid === 0
			? ""
			: `; --allow-spend pays for ${quote.paid} of them: ${spendQuoteCost(quote)}`;
	return `${creates} deferred in "${event.environment}", no free badge quota left today: ${keys}; the free badge quota resets at ${reset} 00:00 UTC${spend}`;
}
