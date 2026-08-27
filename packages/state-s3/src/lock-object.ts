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
import { leaseDeadlineAt } from "./lease.ts";
import { releaseRefused, renewRefused } from "./lock-failure.ts";
import {
	isoAt,
	parseLockRecord,
	type S3LockClaim,
	type S3LockRecord,
	serializeLockRecord,
} from "./lock-record.ts";
import { readObjectTextAsync } from "./s3-client.ts";

/**
 * The wildcard a conditional create requires the object to be absent with,
 * sent bare. At least one S3-compatible implementation compares the raw
 * header value before stripping quotes, so a quoted wildcard reads there as
 * an ETag comparison the store finds satisfied.
 */
export const ABSENT = "*";

// What the lock object's bytes are written as.
const LOCK_CONTENT_TYPE = "application/json";

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
	/**
	 * Starts a repeating schedule, handing back what cancels it. This is
	 * what keeps a hold's **Lease** alive while the deploy runs.
	 */
	readonly scheduleEvery: (ms: number, run: () => Promise<void>) => () => void;
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
export interface WonHold extends UntaggedHold {
	/** Entity tag the store answered the winning write with. */
	readonly etag: string;
}

/**
 * One renewal of a hold's **Lease**, read as an outcome.
 *
 * `refused` is the store declining the write the hold is conditional on,
 * which is another run holding the **Environment** now. `failed` is every
 * other refusal, which the hold outlives as long as a later renewal lands
 * before its deadline. `untagged` is a renewal the store took and named no
 * entity tag for, which leaves the deadline pushed out and the next write
 * nothing to be conditional on.
 */
export type LeaseRenewal =
	| { readonly error: StateLockError; readonly kind: "failed" }
	| { readonly error: StateLockError; readonly kind: "refused" }
	| { readonly held: UntaggedHold; readonly kind: "untagged" }
	| { readonly held: WonHold; readonly kind: "renewed" };

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

/** A renewal the store took without naming what to write against next. */
interface UntaggedHold {
	/** The record the renewal put on the object. */
	readonly record: S3LockRecord;
}

/** What one conditional write of the lock object came back with. */
type LockWrite =
	| { readonly etag: string | undefined; readonly kind: "stored" }
	| { readonly failure: S3Failure; readonly kind: "refused" };

/** What {@link putLockAsync} needs to write the lock object once. */
interface LockWriteInputs {
	/** The acquisition the write belongs to. */
	readonly acquisition: Acquisition;
	/** What the object must look like for the write to land. */
	readonly condition: LockCondition;
	/** The record to store. */
	readonly record: S3LockRecord;
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
 * Push one hold's **Lease** deadline out, conditional on the bytes the
 * hold currently stands on.
 *
 * @param acquisition - The acquisition that won.
 * @param held - The record on the object, and the tag to write against.
 * @returns The renewed hold, or why the **Lease** could not be kept.
 */
export async function renewLeaseAsync(
	acquisition: Acquisition,
	{ etag, record }: WonHold,
): Promise<LeaseRenewal> {
	const { label, seams } = acquisition;
	const renewed: S3LockRecord = {
		...record,
		expiresAt: leaseDeadlineAt(seams.now(), seams.leaseMs),
	};

	const written = await putLockAsync({
		acquisition,
		condition: { etag, kind: "unchanged" },
		record: renewed,
	});
	if (written.kind === "refused") {
		return {
			error: renewRefused(label, written.failure),
			kind: isConditionRefusal(written.failure) ? "refused" : "failed",
		};
	}

	return written.etag === undefined
		? { held: { record: renewed }, kind: "untagged" }
		: { held: { etag: written.etag, record: renewed }, kind: "renewed" };
}

/**
 * Write the tombstone that gives one hold up.
 *
 * @param acquisition - The acquisition that won.
 * @param won - The record on the object, and the tag to write against.
 * @returns `Ok` once the tombstone is stored, or why it was refused.
 */
export async function releaseAsync(
	acquisition: Acquisition,
	{ etag, record }: WonHold,
): Promise<Result<void, StateLockError>> {
	const written = await putLockAsync({
		acquisition,
		condition: { etag, kind: "unchanged" },
		record: { ...record, releasedAt: isoAt(acquisition.seams.now()) },
	});
	return written.kind === "refused"
		? { err: releaseRefused(acquisition.label, written.failure), success: false }
		: { data: undefined, success: true };
}

/**
 * Write the lock object, conditionally.
 *
 * @param acquisition - The acquisition in progress.
 * @param condition - What the object must look like for the write to land.
 * @returns The hold, the refusal, or that the condition was declined.
 */
export async function writeLockAsync(
	acquisition: Acquisition,
	condition: LockCondition,
): Promise<LockAttempt> {
	const { claim, seams } = acquisition;
	// Stamped as the write goes out, so the **Lease** runs from the instant
	// the store took the hold.
	const takenAt = seams.now();
	const record: S3LockRecord = {
		...claim,
		expiresAt: leaseDeadlineAt(takenAt, seams.leaseMs),
		since: isoAt(takenAt),
	};

	const written = await putLockAsync({ acquisition, condition, record });
	if (written.kind === "stored") {
		return { etag: written.etag, kind: "acquired", record };
	}

	return isConditionRefusal(written.failure)
		? { kind: "contended" }
		: { failure: written.failure, kind: "failed" };
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

/**
 * Write one record into the lock object, on the condition the caller
 * named.
 *
 * @param inputs - The acquisition, the record, and what the object must
 * look like for the write to land.
 * @returns The entity tag the store answered with, or the refusal.
 */
async function putLockAsync({
	acquisition,
	condition,
	record,
}: LockWriteInputs): Promise<LockWrite> {
	const { key, bucket, client } = acquisition;

	try {
		const written = await client.send(
			new PutObjectCommand({
				...(condition.kind === "absent"
					? { IfNoneMatch: ABSENT }
					: { IfMatch: condition.etag }),
				Body: serializeLockRecord(record),
				Bucket: bucket,
				ContentType: LOCK_CONTENT_TYPE,
				Key: key,
			}),
		);
		return { etag: written.ETag, kind: "stored" };
	} catch (err) {
		return { failure: classifyS3Failure(err), kind: "refused" };
	}
}
