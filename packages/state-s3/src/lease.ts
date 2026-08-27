import { isoAt, type S3LockRecord } from "./lock-record.ts";

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

/**
 * Read whether one hold's **Lease** has run out.
 *
 * A hold is renewed while the deploy holding it runs, so a deadline the
 * clock has reached is a holder that stopped renewing: the run died, and
 * the **Environment** is free to be taken over.
 *
 * @param record - The record found holding the **Environment**.
 * @param nowMs - Epoch milliseconds the clock read.
 * @returns `true` once the hold may be taken over.
 */
export function isLeaseExpired(record: S3LockRecord, nowMs: number): boolean {
	return Date.parse(record.expiresAt) <= nowMs;
}
