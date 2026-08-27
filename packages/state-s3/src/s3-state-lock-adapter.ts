import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
	type Result,
	type StateLockError,
	type StateLockHold,
	type StateLockPort,
	validateEnvironmentName,
} from "@bedrock-rbx/core";

import { backoffDelayMs } from "./backoff.ts";
import {
	classifyS3Failure,
	isConditionRefusal,
	type S3Failure,
	type S3FailureKind,
} from "./classify-failure.ts";
import {
	acquireRefused,
	holdWithoutEntityTag,
	invalidEnvironment,
	releaseRefused,
	timedOut,
} from "./lock-failure.ts";
import {
	holderOf,
	isoAt,
	parseLockRecord,
	randomLockId,
	type S3LockHolder,
	type S3LockRecord,
	serializeLockRecord,
} from "./lock-record.ts";
import { lockKeyFor, objectLabelFor } from "./object-key.ts";
import { createConfiguredS3Client, readObjectTextAsync, type S3StoreDeps } from "./s3-client.ts";

/**
 * How long acquisition waits out contention before giving up, when the
 * config names no bound of its own.
 *
 * @since unreleased
 */
export const DEFAULT_LOCK_TIMEOUT_MS = 300_000;

// What a hold is recorded as being for when the caller names no operation.
const DEFAULT_OPERATION = "deploy";

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

/**
 * Everything {@link createS3StateLockPort} needs beyond the bucket it
 * shares with the **State port**.
 *
 * @since unreleased
 */
export interface S3StateLockAdapterDeps extends S3StoreDeps {
	/**
	 * How long acquisition waits out contention before giving up, in
	 * milliseconds. Defaults to {@link DEFAULT_LOCK_TIMEOUT_MS}.
	 */
	readonly lockTimeoutMs?: number | undefined;
	/**
	 * Mints the identity one acquisition records, which is what tells its
	 * own landed record apart from another run's hold. Defaults to a
	 * random UUID.
	 */
	readonly mintId?: (() => string) | undefined;
	/** Reads the wall clock, in epoch milliseconds. Defaults to `Date.now`. */
	readonly now?: (() => number) | undefined;
	/** Who the hold is recorded as belonging to. */
	readonly owner: string;
	/** Waits between attempts. Defaults to a timer. */
	readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** The seams one acquisition runs on, settled from the deps once. */
interface LockSeams {
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
interface Acquisition {
	/** The object the hold is recorded in. */
	readonly key: string;
	/** Bucket the lock object lives in. */
	readonly bucket: string;
	/** The configured S3 client. */
	readonly client: S3Client;
	/** That object addressed the way an operator would write it. */
	readonly label: string;
	/** What this acquisition writes when it wins. */
	readonly record: S3LockRecord;
	/** The clock, the waiting, and the identity this acquisition runs on. */
	readonly seams: LockSeams;
}

/** What the lock object must look like for one write to land. */
type LockCondition =
	| { readonly etag: string; readonly kind: "unchanged" }
	| { readonly kind: "absent" };

/** One conditional write of the lock object, read as an outcome. */
type LockAttempt =
	| { readonly etag: string | undefined; readonly kind: "acquired" }
	| { readonly failure: S3Failure; readonly kind: "failed" }
	| { readonly kind: "contended" };

/** What one read of the lock object came back with. */
type LockRead =
	| { readonly etag: string | undefined; readonly kind: "read"; readonly record: S3LockRecord }
	| { readonly failure: S3Failure; readonly kind: "failed" }
	| { readonly kind: "unreadable" };

/** What one round of contention learned about who holds the **Environment**. */
interface HolderReading {
	/** Who holds it, absent when the round found nobody it could name. */
	readonly holder: S3LockHolder | undefined;
	/** Whether the round learned who holds it at all. */
	readonly identified: boolean;
}

/** What one round of contention ended in. */
type ContendOutcome =
	| Exclude<LockAttempt, { kind: "contended" }>
	| { readonly kind: "contended"; readonly reading: HolderReading };

/** What {@link openAcquisition} needs to open one. */
interface AcquisitionInputs {
	/** The configured S3 client. */
	readonly client: S3Client;
	/** Bucket coordinates and who the hold belongs to. */
	readonly deps: S3StateLockAdapterDeps;
	/** **Environment** the hold covers, already validated. */
	readonly environment: string;
	/** What the caller said the hold is for. */
	readonly operation: string | undefined;
	/** The clock, the waiting, and the identity to run on. */
	readonly seams: LockSeams;
}

/** What the caller said the hold is for, and where to report a wait. */
type AcquireOptions = Parameters<StateLockPort["acquire"]>[1];

/**
 * Wait, on a real timer.
 *
 * Exported for direct coverage of the waiting itself, which a test driving
 * acquisition on an injected clock cannot observe.
 *
 * @param ms - Milliseconds to wait.
 */
export async function delayAsync(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Build a `StateLockPort` that takes exclusion on one **Environment**
 * through a conditional create in the bucket, waiting out a hold another
 * run has rather than refusing outright.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { createS3StateLockPort } from "@bedrock-rbx/state-s3";
 *
 * const port = createS3StateLockPort({
 *     bucket: "my-bucket",
 *     credentials: { accessKeyId: "example-access-key", secretAccessKey: "example-secret" },
 *     fetch: async () => new Response("", { headers: { etag: '"held"' }, status: 200 }),
 *     owner: "ci-run-7",
 *     region: "eu-west-2",
 * });
 *
 * return port.acquire("production", { operation: "deploy" }).then(async (hold) => {
 *     expect(hold.success).toBeTrue();
 *     if (hold.success) {
 *         const given = await hold.data.release();
 *         expect(given.success).toBeTrue();
 *     }
 * });
 * ```
 *
 * @param deps - Bucket coordinates, who the hold belongs to, and the
 * clock, transport, and identity seams.
 * @returns A `StateLockPort` ready to be handed to a **Deploy**.
 */
export function createS3StateLockPort(deps: S3StateLockAdapterDeps): StateLockPort {
	const client = createConfiguredS3Client(deps);
	const seams: LockSeams = {
		mintId: deps.mintId ?? randomLockId,
		now: deps.now ?? Date.now,
		sleepAsync: deps.sleep ?? delayAsync,
		timeoutMs: deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
	};

	return {
		async acquire(environment, options) {
			const safe = validateEnvironmentName(environment);
			if (!safe.success) {
				return { err: invalidEnvironment(safe.err.file, safe.err.reason), success: false };
			}

			const acquisition = openAcquisition({
				client,
				deps,
				environment: safe.data,
				operation: options?.operation,
				seams,
			});
			return acquireAsync(acquisition, options);
		},
	};
}

/**
 * Open one acquisition over the object that holds an **Environment**'s
 * lock.
 *
 * @param inputs - The bucket, the client, the seams, the **Environment**,
 * and what the hold is for.
 * @returns The acquisition, ready to contend.
 */
function openAcquisition({
	client,
	deps,
	environment,
	operation,
	seams,
}: AcquisitionInputs): Acquisition {
	const key = lockKeyFor(deps.prefix, environment);
	return {
		key,
		bucket: deps.bucket,
		client,
		label: objectLabelFor(deps.bucket, key),
		record: {
			id: seams.mintId(),
			operation: operation ?? DEFAULT_OPERATION,
			owner: deps.owner,
			since: isoAt(seams.now()),
		},
		seams,
	};
}

/**
 * Report what one round learned about who is in the way.
 *
 * @param holder - Who holds the **Environment**, absent when the round
 * found nobody it could name.
 * @param identified - Whether the round learned who holds it at all.
 * @returns The round's outcome.
 */
function contended(holder: S3LockHolder | undefined, identified: boolean): ContendOutcome {
	return { kind: "contended", reading: { holder, identified } };
}

/**
 * Write the lock object, conditionally.
 *
 * @param acquisition - The acquisition in progress.
 * @param condition - What the object must look like for the write to land.
 * @returns The hold, the refusal, or that the condition was declined.
 */
async function writeLockAsync(
	{ key, bucket, client, record }: Acquisition,
	condition: LockCondition,
): Promise<LockAttempt> {
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
		return { etag: written.ETag, kind: "acquired" };
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
async function takeOverAsync(
	acquisition: Acquisition,
	etag: string | undefined,
): Promise<LockAttempt> {
	return etag === undefined
		? { kind: "contended" }
		: writeLockAsync(acquisition, { etag, kind: "unchanged" });
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
async function readLockAsync({ key, bucket, client }: Acquisition): Promise<LockRead> {
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
 * Make one attempt on the lock object: a conditional create, and where a
 * release left a tombstone behind, a takeover written against it.
 *
 * @param acquisition - The acquisition in progress.
 * @returns The hold, the refusal, or what the round learned about who is in
 * the way.
 */
async function contendAsync(acquisition: Acquisition): Promise<ContendOutcome> {
	const created = await writeLockAsync(acquisition, { kind: "absent" });
	if (created.kind !== "contended") {
		return created;
	}

	const found = await readLockAsync(acquisition);
	if (found.kind === "failed") {
		return found;
	}

	if (found.kind === "unreadable") {
		return contended(undefined, false);
	}

	// A conditional create can land at the store and still be reported as a
	// refusal, so the record in the way is sometimes this acquisition's own.
	// Reporting it as the blocker would strand the very hold it just took.
	if (found.record.id === acquisition.record.id) {
		return { etag: found.etag, kind: "acquired" };
	}

	if (found.record.releasedAt === undefined) {
		return contended(holderOf(found.record), true);
	}

	// The object outlives the hold: release writes a tombstone into it. The
	// takeover is conditional on the exact bytes that were read, so a run
	// that got there first keeps what it took.
	const takenOver = await takeOverAsync(acquisition, found.etag);
	return takenOver.kind === "contended" ? contended(undefined, true) : takenOver;
}

/**
 * Write the tombstone that gives one hold up.
 *
 * @param acquisition - The acquisition that won.
 * @param etag - Entity tag the store answered the winning write with.
 * @returns `Ok` once the tombstone is stored, or why it was refused.
 */
async function releaseAsync(
	{ key, bucket, client, label, record, seams }: Acquisition,
	etag: string,
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
 * Hand back the hold, which gives itself up by writing a tombstone over
 * the exact record it took.
 *
 * @param acquisition - The acquisition that won.
 * @param etag - Entity tag the store answered the winning write with.
 * @returns The hold the deploy shell gives up when the work is over.
 */
function grantHold(acquisition: Acquisition, etag: string): StateLockHold {
	return {
		async release() {
			return releaseAsync(acquisition, etag);
		},
	};
}

/**
 * Turn a settled attempt into the hold or the failure a caller sees.
 *
 * @param acquisition - The acquisition in progress.
 * @param attempt - What the store answered.
 * @returns The hold, or why it could not be taken.
 */
function settle(
	acquisition: Acquisition,
	attempt: Exclude<LockAttempt, { kind: "contended" }>,
): Result<StateLockHold, StateLockError> {
	const { label } = acquisition;

	if (attempt.kind === "failed") {
		return { err: acquireRefused(label, attempt.failure), success: false };
	}

	if (attempt.etag === undefined) {
		return { err: holdWithoutEntityTag(label), success: false };
	}

	return { data: grantHold(acquisition, attempt.etag), success: true };
}

/**
 * Wait out a hold another run has, taking the **Environment** as soon as
 * the store accepts the conditional create.
 *
 * The retry carries on through a read it could not make. That read is the
 * one contention itself breaks, and a holder releasing mid-wait has to end
 * in acquisition. The record is read only to name the blocker, to tell this
 * acquisition's own landed write from another run's hold, and to take over
 * the tombstone a release leaves behind.
 *
 * @param acquisition - The object being contended for, and the seams the
 * wait runs on.
 * @param options - Where to report the wait.
 * @returns The hold, or why it could not be taken.
 */
async function acquireAsync(
	acquisition: Acquisition,
	options: AcquireOptions,
): Promise<Result<StateLockHold, StateLockError>> {
	const { now, sleepAsync, timeoutMs } = acquisition.seams;
	const startedAt = now();

	let blocker: S3LockHolder | undefined;

	for (let attempt = 1; ; attempt += 1) {
		const round = await contendAsync(acquisition);
		if (round.kind !== "contended") {
			return settle(acquisition, round);
		}

		// A round that read the object replaces what the last one knew, so a
		// holder that has since released is never reported as still holding.
		blocker = round.reading.identified ? round.reading.holder : blocker;
		const elapsedMs = now() - startedAt;
		const remainingMs = timeoutMs - elapsedMs;
		if (remainingMs <= 0) {
			return {
				err: timedOut({ blocker, elapsedMs, label: acquisition.label }),
				success: false,
			};
		}

		options?.onWaiting?.({ elapsedMs, holder: blocker?.owner, remainingMs });
		await sleepAsync(backoffDelayMs({ attempt, remainingMs }));
	}
}
