import { type } from "arktype";

/**
 * What one acquisition writes itself down as, before the instant it took
 * the hold is stamped on.
 */
export interface S3LockClaim {
	/** Identity of the acquisition writing the record. */
	readonly id: string;
	/** What the hold is being taken for. */
	readonly operation: string;
	/** Who the hold belongs to. */
	readonly owner: string;
}

/**
 * Who holds one **Environment**, and since when.
 *
 * @since unreleased
 */
export interface S3LockHolder {
	/** ISO-8601 instant the hold's **Lease** runs out on. */
	readonly expiresAt: string;
	/** What the hold was taken for, as the holder named it. */
	readonly operation: string;
	/** Who the holder recorded itself as. */
	readonly owner: string;
	/** ISO-8601 instant the hold was taken. */
	readonly since: string;
}

/**
 * What one lock object holds: who took the hold, what for, until when, and the
 * identity of the acquisition that wrote it.
 *
 * `id` is what keeps a retried acquisition from blocking on itself. A
 * conditional create can land at the store and still be reported to the
 * caller as a failure, so the record found in the way of the next attempt
 * is sometimes the caller's own; comparing ids is how that is told apart
 * from another run's hold.
 *
 * `releasedAt` is the tombstone: a hold is given up by writing the record
 * back with it set.
 */
export interface S3LockRecord extends S3LockHolder {
	/** Identity of the acquisition that wrote this record. */
	readonly id: string;
	/** ISO-8601 instant the hold was given up, absent while it is held. */
	readonly releasedAt?: string;
}

// A field the record has to carry a value for: a blank identity names no
// acquisition, and a blank instant names no moment.
const NON_EMPTY_STRING = "string > 0";

const lockRecordSchema = type({
	"id": NON_EMPTY_STRING,
	"expiresAt": NON_EMPTY_STRING,
	"operation": "string",
	"owner": "string",
	"releasedAt?": NON_EMPTY_STRING,
	"since": "string",
});

/**
 * Render one lock record as the bytes the lock object holds.
 *
 * @param record - The hold to write.
 * @returns The object body.
 */
export function serializeLockRecord(record: S3LockRecord): string {
	return JSON.stringify(record, undefined, 2);
}

/**
 * Read one lock object's bytes back into a record.
 *
 * A record that does not parse is reported as absent. The caller reads a
 * blocking holder only to name it and to tell it apart from itself, and
 * neither needs the bytes to be well formed.
 *
 * @param text - Everything the lock object holds.
 * @returns The record, or `undefined` when the bytes are not one.
 */
export function parseLockRecord(text: string): S3LockRecord | undefined {
	const parsed = lockRecordSchema(safeParse(text));
	return parsed instanceof type.errors ? undefined : parsed;
}

/**
 * Read the holder out of a record, dropping the parts only acquisition
 * uses.
 *
 * @param record - The record found holding the **Environment**.
 * @returns Who holds it and since when.
 */
export function holderOf(record: S3LockRecord): S3LockHolder {
	return {
		expiresAt: record.expiresAt,
		operation: record.operation,
		owner: record.owner,
		since: record.since,
	};
}

/**
 * Stamp one instant the way a lock record carries it.
 *
 * @param ms - Epoch milliseconds the clock read.
 * @returns The instant, in ISO-8601.
 */
export function isoAt(ms: number): string {
	const at = new Date(ms);
	return at.toISOString();
}

/**
 * Mint the identity one acquisition records.
 *
 * @returns An identity no other acquisition writes.
 */
export function randomLockId(): string {
	return crypto.randomUUID();
}

/**
 * Parse JSON that may not be JSON at all.
 *
 * @param text - Bytes read from the lock object.
 * @returns Whatever the text parsed to, or `undefined` when it is not JSON.
 */
function safeParse(text: string): JSONValue | undefined {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
