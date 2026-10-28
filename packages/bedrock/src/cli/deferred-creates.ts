import type { BadgeCreatesDeferredEvent } from "../ports/progress-port.ts";

/**
 * Render the warning for badge creates a Deploy left for a later Deploy.
 *
 * @param event - The deferred creates, their Environment, and the reset.
 * @returns One line naming the deferred Keys and the next quota reset.
 */
export function deferredCreatesLine(event: BadgeCreatesDeferredEvent): string {
	const count = event.deferred.length;
	const creates = `${count} badge ${count === 1 ? "create" : "creates"}`;
	const keys = event.deferred.map(({ key }) => key).join(", ");
	const reset = event.resetsAt.toISOString().slice(0, 10);
	return `${creates} deferred in "${event.environment}", no free badge quota left today: ${keys}; the free badge quota resets at ${reset} 00:00 UTC`;
}
