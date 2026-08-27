import { isoAt } from "./lock-record.ts";

/**
 * How long a hold is leased for when the config names no lease of its own,
 * in milliseconds.
 *
 * A hold stops being renewed the moment the run holding it dies, so this
 * is how long an **Environment** a cancelled CI job left behind stays out
 * of reach of the next deploy.
 *
 * @since unreleased
 */
export const DEFAULT_LOCK_LEASE_MS = 60_000;

/**
 * Stamp the deadline a hold taken now runs out on.
 *
 * @param nowMs - Epoch milliseconds the clock read.
 * @param leaseMs - How long the hold is leased for.
 * @returns The deadline, in ISO-8601.
 */
export function leaseExpiryAt(nowMs: number, leaseMs: number): string {
	return isoAt(nowMs + leaseMs);
}
