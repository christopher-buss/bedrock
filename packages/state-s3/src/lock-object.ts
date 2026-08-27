import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import type { Result, StateLockError } from "@bedrock-rbx/core";

import {
	classifyS3Failure,
	isConditionRefusal,
	type S3Failure,
	type S3FailureKind,
} from "./classify-failure.ts";
import { leaseExpiryAt } from "./lease.ts";
import { releaseRefused } from "./lock-failure.ts";
import {
	isoAt,
	parseLockRecord,
	type S3LockClaim,
	type S3LockRecord,
	serializeLockRecord,
} from "./lock-record.ts";
import { readObjectTextAsync } from "./s3-client.ts";

// The wildcard a conditional create requires the object to be absent with,
// sent bare. At least one S3-compatible implementation compares the raw
// header value before stripping quotes, so a quoted wildcard reads there as
// an ETag comparison the store finds satisfied.
const ABSENT = "*";

// Refusals of a read that will still refuse however long acquisition waits.
// Every other refusal is transient as far as this **Backend** can tell, so
// the wait carries on through it.
const PERMANENT_READ_REFUSAL: ReadonlySet<S3FailureKind> = new Set([
	"accessDenied",
	"missingCredentials",
]);

/** The seams one acquisition runs on, settled from the deps once. */
export interface LockSeams {
	/** How long a hold is leased for before it expires, in milliseconds. */
	readonly leaseMs: number;
	/** Mints the identity this acquisition records. */
	readonly mintId: () => string;
	/** Reads the wall clock, in epoch milliseconds. */
	readonly now: () => number;
	/** Waits between attempts. */
	readonly sleepAsync: (ms: number) => Promise<void>;
	/** How long to wait out contention before giving up, in milliseconds. */
	readonly timeoutMs: number;
}

/** One acquisition in progress, over the object it is contending for. */
export interface Acquisition {
	/** The object the hold is recorded in. */
	readonly key: string;
	/** Bucket the lock object lives in. */
	readonly bucket: string;
	/** Who this acquisition writes itself down as when it wins. */
	readonly claim: S3LockClaim;
	/** The configured S3 client. */
	readonly client: S3Client;
	/** That object addressed the way an operator would write it. */
	readonly label: string;
	/** The clock, the waiting, and the identity this acquisition runs on. */
	readonly seams: LockSeams;
}

/** What the lock object must look like for one write to land. */
export type LockCondition =
	| { readonly etag: string; readonly kind: "unchanged" }
	| { readonly kind: "absent" };

/** One conditional write of the lock object, read as an outcome. */
export type LockAttempt =
	| ContendedAttempt
	| {
			readonly etag: string | undefined;
			readonly kind: "acquired";
			readonly record: S3LockRecord;
	  }
	| { readonly failure: S3Failure; readonly kind: "failed" };

/** An attempt that is done contending, whichever way it went. */
export type SettledAttempt = Exclude<LockAttempt, ContendedAttempt>;

/** What a won acquisition gives up: the record it wrote, and its tag. */
export interface WonHold {
	/** Entity tag the store answered the winning write with. */
	readonly etag: string;
	/** The record the winning write put on the object. */
	readonly record: S3LockRecord;
}

/** What one read of the lock object came back with. */
export type LockRead =
	| { readonly etag: string | undefined; readonly kind: "read"; readonly record: S3LockRecord }
	| { readonly failure: S3Failure; readonly kind: "failed" }
	| { readonly kind: "unreadable" };

/** A write the store declined the condition of. */
interface ContendedAttempt {
	/** Which outcome this is. */
	readonly kind: "contended";
}

/**
 * Take away a lock object this acquisition wrote and can never give up.
 *
 * Nothing takes an active record over, so a record with no entity tag to
 * release it against would hold the **Environment** until somebody cleared
 * the object by hand. Taking it away leaves the next deploy meeting the
 * same honest refusal instead of waiting out a hold no run can give up. A
 * refusal here is passed over: the missing entity tag is the failure the
 * caller reports.
 *
 * @param acquisition - The acquisition whose record is on the object.
 * @param record - The record it wrote there.
 * @returns The acquisition, settled as a hold with no entity tag.
 */
export async function discardOwnAsync(
	{ key, bucket, client }: Acquisition,
	record: S3LockRecord,
): Promise<SettledAttempt> {
	try {
		await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
	} catch {
		// Reported as the missing entity tag either way.
	}

	return { etag: undefined, kind: "acquired", record };
}

/**
 * Read the lock object.
 *
 * A refusal the wait cannot outlast ends the acquisition: a credential that
 * cannot read the record will not start being able to, and waiting five
 * minutes before reporting the **Environment** as another run's would name
 * the wrong cause. Everything else reads as unreadable, and the wait
 * carries on.
 *
 * @param acquisition - The acquisition in progress.
 * @returns The record and its entity tag, that the read did not land, or
 * the refusal that ends the wait.
 */
export async function readLockAsync({ key, bucket, client }: Acquisition): Promise<LockRead> {
	try {
		const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
		const record = parseLockRecord(await readObjectTextAsync(object.Body));
		return record === undefined
			? { kind: "unreadable" }
			: { etag: object.ETag, kind: "read", record };
	} catch (err) {
		const failure = classifyS3Failure(err);
		return PERMANENT_READ_REFUSAL.has(failure.kind)
			? { failure, kind: "failed" }
			: { kind: "unreadable" };
	}
}

/**
 * Write the tombstone that gives one hold up.
 *
 * @param acquisition - The acquisition that won.
 * @param won - The record on the object, and the tag to write against.
 * @returns `Ok` once the tombstone is stored, or why it was refused.
 */
export async function releaseAsync(
	{ key, bucket, client, label, seams }: Acquisition,
	{ etag, record }: WonHold,
): Promise<Result<void, StateLockError>> {
	try {
		await client.send(
			new PutObjectCommand({
				Body: serializeLockRecord({ ...record, releasedAt: isoAt(seams.now()) }),
				Bucket: bucket,
				ContentType: "application/json",
				IfMatch: etag,
				Key: key,
			}),
		);
		return { data: undefined, success: true };
	} catch (err) {
		return { err: releaseRefused(label, classifyS3Failure(err)), success: false };
	}
}

/**
 * Write the lock object, conditionally.
 *
 * @param acquisition - The acquisition in progress.
 * @param condition - What the object must look like for the write to land.
 * @returns The hold, the refusal, or that the condition was declined.
 */
export async function writeLockAsync(
	{ key, bucket, claim, client, seams }: Acquisition,
	condition: LockCondition,
): Promise<LockAttempt> {
	// Stamped as the write goes out, so the **Lease** runs from the instant
	// the store took the hold.
	const takenAt = seams.now();
	const record: S3LockRecord = {
		...claim,
		expiresAt: leaseExpiryAt(takenAt, seams.leaseMs),
		since: isoAt(takenAt),
	};

	try {
		const written = await client.send(
			new PutObjectCommand({
				...(condition.kind === "absent"
					? { IfNoneMatch: ABSENT }
					: { IfMatch: condition.etag }),
				Body: serializeLockRecord(record),
				Bucket: bucket,
				ContentType: "application/json",
				Key: key,
			}),
		);
		return { etag: written.ETag, kind: "acquired", record };
	} catch (err) {
		const failure = classifyS3Failure(err);
		return isConditionRefusal(failure) ? { kind: "contended" } : { failure, kind: "failed" };
	}
}

/**
 * Take a lock object with a tombstone in it over, conditional on the bytes
 * that were read.
 *
 * A store that answered the read without an entity tag leaves nothing to
 * condition on, so the takeover is not attempted and the wait carries on.
 *
 * @param acquisition - The acquisition in progress.
 * @param etag - Entity tag the read came back with.
 * @returns The hold, the refusal, or that the takeover was declined.
 */
export async function takeOverAsync(
	acquisition: Acquisition,
	etag: string | undefined,
): Promise<LockAttempt> {
	return etag === undefined
		? { kind: "contended" }
		: writeLockAsync(acquisition, { etag, kind: "unchanged" });
}
