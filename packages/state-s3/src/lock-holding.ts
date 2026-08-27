import type { S3Client } from "@aws-sdk/client-s3";
import {
	type Result,
	type StateLockError,
	type StateLockHolding,
	validateEnvironmentName,
} from "@bedrock-rbx/core";

import { isLeaseExpired } from "./lease.ts";
import { inspectRefused, invalidEnvironment } from "./lock-failure.ts";
import { displaceAsync, type LockObject, readLockAsync } from "./lock-object.ts";
import { holderOf, type S3LockRecord } from "./lock-record.ts";
import { lockKeyFor, objectLabelFor } from "./object-key.ts";

/** Where one **Environment**'s lock object is addressed. */
export interface LockObjectTarget {
	/** Bucket the lock objects live in. */
	readonly bucket: string;
	/** The configured S3 client. */
	readonly client: S3Client;
	/** **Environment** the hold covers, as the caller named it. */
	readonly environment: string;
	/** Folder the lock objects are written under. */
	readonly prefix: string | undefined;
}

/**
 * Address the lock object one **Environment**'s hold is recorded in.
 *
 * @param target - The bucket, the client, and the **Environment** to
 * address.
 * @returns The object to read or write, or the **Environment** name that
 * could not address one.
 */
export function openLockObject({
	bucket,
	client,
	environment,
	prefix,
}: LockObjectTarget): Result<LockObject, StateLockError> {
	const safe = validateEnvironmentName(environment);
	if (!safe.success) {
		return { err: invalidEnvironment(safe.err.file, safe.err.reason), success: false };
	}

	const key = lockKeyFor(prefix, safe.data);
	return {
		data: { key, bucket, client, label: objectLabelFor(bucket, key) },
		success: true,
	};
}

/**
 * Read who holds one **Environment**, without taking a hold.
 *
 * A record the store would not hand over at all is reported as a failure:
 * a caller told nobody holds the **Environment** would read that as a
 * preview nothing can have raced. Bytes that are there but are not a
 * record read as nobody holding it, on the same terms acquisition reads
 * them.
 *
 * @param object - The lock object to read.
 * @param nowMs - Epoch milliseconds the clock read.
 * @returns Who holds it, or `undefined` when nobody does.
 */
export async function readHoldingAsync(
	object: LockObject,
	nowMs: number,
): Promise<Result<StateLockHolding | undefined, StateLockError>> {
	const found = await readLockAsync(object);
	if (found.kind === "failed") {
		return { err: inspectRefused(object.label, found.failure), success: false };
	}

	return {
		data: found.kind === "read" ? holdingOf(found.record, nowMs) : undefined,
		success: true,
	};
}

/**
 * Take one **Environment**'s hold away, whoever holds it.
 *
 * An **Environment** nothing is holding is left exactly as it is: a
 * tombstone written over a record that already carries one, or over a
 * **Lease** the clock has passed, would displace nobody while overwriting
 * what the next deploy takes over.
 *
 * @param object - The lock object the hold is recorded in.
 * @param nowMs - Epoch milliseconds the clock read.
 * @returns Who was displaced, or `undefined` when nobody was.
 */
export async function forceReleaseAsync(
	object: LockObject,
	nowMs: number,
): Promise<Result<StateLockHolding | undefined, StateLockError>> {
	const found = await readLockAsync(object);
	if (found.kind === "failed") {
		return { err: inspectRefused(object.label, found.failure), success: false };
	}

	if (found.kind !== "read") {
		return { data: undefined, success: true };
	}

	const displaced = holdingOf(found.record, nowMs);
	if (displaced === undefined) {
		return { data: undefined, success: true };
	}

	const written = await displaceAsync(object, { etag: found.etag, nowMs, record: found.record });
	return written.success ? { data: displaced, success: true } : written;
}

/**
 * Read one record as the hold a read-only caller is told about.
 *
 * A tombstone and a **Lease** the clock has passed are both holds the next
 * deploy takes over rather than waits on, so neither is reported as one
 * holding the **Environment** now.
 *
 * @param record - The record found on the lock object.
 * @param nowMs - Epoch milliseconds the clock read.
 * @returns Who holds it, or `undefined` when nobody does.
 */
function holdingOf(record: S3LockRecord, nowMs: number): StateLockHolding | undefined {
	if (record.releasedAt !== undefined || isLeaseExpired(record, nowMs)) {
		return undefined;
	}

	const holder = holderOf(record);
	return { operation: holder.operation, owner: holder.owner, since: holder.since };
}
