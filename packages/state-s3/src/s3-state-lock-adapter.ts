import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
	type Result,
	type StateLockError,
	type StateLockHold,
	type StateLockPort,
	validateEnvironmentName,
} from "@bedrock-rbx/core";

import { backoffDelayMs } from "./backoff.ts";
import { classifyS3Failure, isConditionRefusal, type S3Failure } from "./classify-failure.ts";
import {
	holderOf,
	parseLockRecord,
	type S3LockHolder,
	type S3LockRecord,
	serializeLockRecord,
} from "./lock-record.ts";
import { lockKeyFor, objectLabelFor } from "./object-key.ts";
import { createConfiguredS3Client, type S3StateAdapterDeps } from "./s3-client.ts";
import { readObjectTextAsync } from "./s3-state-adapter.ts";

/**
 * How long acquisition waits out contention before giving up, when the
 * config names no bound of its own.
 *
 * @since unreleased
 */
export const DEFAULT_LOCK_TIMEOUT_MS = 300_000;

// What a hold is recorded as being for when the caller names no operation.
const DEFAULT_OPERATION = "deploy";

// The wildcard is sent bare. At least one S3-compatible implementation
// compares the raw header value before stripping quotes, so a quoted
// wildcard falls through to an ETag comparison, the condition evaluates as
// satisfied, and the conditional create degrades into an unconditional
// overwrite that grants two writers the same hold.
const ABSENT = "*";

/**
 * Everything {@link createS3StateLockPort} needs beyond the bucket it
 * shares with the **State port**.
 *
 * @since unreleased
 */
export interface S3StateLockAdapterDeps extends S3StateAdapterDeps {
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

/**
 * What went wrong taking or giving up a hold, in terms this **Backend**
 * owns.
 *
 * - `acquireTimedOut` - another run held the **Environment** for longer
 *   than acquisition was willing to wait.
 * - `acquireFailed` - the store refused the attempt for a reason other than
 *   the hold being taken.
 * - `releaseFailed` - the tombstone could not be written, so the hold
 *   stands until it is taken over.
 * - `invalidEnvironment` - the **Environment** name could not address an
 *   object.
 *
 * @since unreleased
 */
export type S3LockFailureKind =
	| "acquireFailed"
	| "acquireTimedOut"
	| "invalidEnvironment"
	| "releaseFailed";

/**
 * The payload a lock failure only this **Backend** can describe carries,
 * which core passes through untouched.
 *
 * @since unreleased
 */
export interface S3StateLockErrorDetail {
	/** S3 error code the client read the refusal as. */
	readonly name?: string | undefined;
	/** Milliseconds spent waiting, present only on a timed-out acquisition. */
	readonly elapsedMs?: number | undefined;
	/** The object the hold is recorded in. */
	readonly file: string;
	/** Who held the **Environment**, absent when the record never read. */
	readonly holder?: S3LockHolder | undefined;
	/** What went wrong. */
	readonly kind: S3LockFailureKind;
	/** Status the store answered with, absent when nothing reached it. */
	readonly statusCode?: number | undefined;
}

/** The configured client paired with everything one acquisition needs. */
interface LockAccess {
	/** The configured S3 client. */
	readonly client: S3Client;
	/** Bucket coordinates plus the lock's own seams. */
	readonly deps: S3StateLockAdapterDeps;
}

/** One conditional write of the lock object, read as an outcome. */
type LockAttempt =
	| { readonly etag: string | undefined; readonly kind: "acquired" }
	| { readonly failure: S3Failure; readonly kind: "failed" }
	| { readonly kind: "contended" };

/** What one read of the lock object found, when it landed at all. */
interface LockReading {
	/** Entity tag the object answered with, which a takeover writes against. */
	readonly etag: string | undefined;
	/** The record it holds, absent when the bytes are not one. */
	readonly record: S3LockRecord | undefined;
}

/** One acquisition in progress, over the object it is contending for. */
interface Acquisition {
	/** The object the hold is recorded in. */
	readonly key: string;
	/** The client and the bucket coordinates. */
	readonly access: LockAccess;
	/** That object addressed the way an operator would write it. */
	readonly label: string;
	/** What this acquisition writes when it wins. */
	readonly record: S3LockRecord;
}

/** What one round of contention ended in. */
type ContendOutcome =
	| Exclude<LockAttempt, { kind: "contended" }>
	| { readonly blocker: S3LockHolder | undefined; readonly kind: "contended" };

/** One request for a hold, over the client that will take it. */
interface LockRequest {
	/** The client and the bucket coordinates. */
	readonly access: LockAccess;
	/** **Environment** the hold covers, already validated. */
	readonly environment: string;
	/** What the hold is for, and where to report a wait. */
	readonly options: NonNullable<Parameters<StateLockPort["acquire"]>[1]>;
}

/** One wait that ran out, as it is reported. */
interface TimedOutWait {
	/** The last holder read, absent when none ever was. */
	readonly blocker: S3LockHolder | undefined;
	/** How long the wait ran, in milliseconds. */
	readonly elapsedMs: number;
	/** The object the hold is recorded in, as an operator would write it. */
	readonly label: string;
}

/** The condition one write of the lock object carries. */
interface LockCondition {
	/** Entity tag the object must still answer with. */
	readonly ifMatch?: string | undefined;
	/** Wildcard requiring the object to be absent. */
	readonly ifNoneMatch?: string | undefined;
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
	const access: LockAccess = { client: createConfiguredS3Client(deps), deps };

	return {
		async acquire(environment, options) {
			const safe = validateEnvironmentName(environment);
			if (!safe.success) {
				const detail: S3StateLockErrorDetail = {
					file: safe.err.file,
					kind: "invalidEnvironment",
				};
				return { err: { detail, reason: safe.err.reason }, success: false };
			}

			return acquireAsync({ access, environment: safe.data, options: options ?? {} });
		},
	};
}

/**
 * Write the lock object, conditionally.
 *
 * @param acquisition - The acquisition in progress.
 * @param condition - What the object must look like for the write to land.
 * @returns The hold, the refusal, or that the condition was declined.
 */
async function writeLockAsync(
	{ key, access, record }: Acquisition,
	condition: LockCondition,
): Promise<LockAttempt> {
	try {
		const written = await access.client.send(
			new PutObjectCommand({
				Body: serializeLockRecord(record),
				Bucket: access.deps.bucket,
				ContentType: "application/json",
				IfMatch: condition.ifMatch,
				IfNoneMatch: condition.ifNoneMatch,
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
 * Read the lock object, best effort.
 *
 * @param acquisition - The acquisition in progress.
 * @returns What the object holds, or `undefined` when the read did not
 * land.
 */
async function readLockAsync({ key, access }: Acquisition): Promise<LockReading | undefined> {
	try {
		const object = await access.client.send(
			new GetObjectCommand({ Bucket: access.deps.bucket, Key: key }),
		);
		return {
			etag: object.ETag,
			record: parseLockRecord(await readObjectTextAsync(object.Body)),
		};
	} catch {
		return undefined;
	}
}

/**
 * Make one attempt on the lock object: a conditional create, and where a
 * release left a tombstone behind, a takeover written against it.
 *
 * @param acquisition - The acquisition in progress.
 * @returns The hold, the refusal, or who is in the way.
 */
async function contendAsync(acquisition: Acquisition): Promise<ContendOutcome> {
	const created = await writeLockAsync(acquisition, { ifNoneMatch: ABSENT });
	if (created.kind !== "contended") {
		return created;
	}

	const reading = await readLockAsync(acquisition);
	if (reading?.record === undefined) {
		return { blocker: undefined, kind: "contended" };
	}

	// A conditional create can land at the store and still be reported as a
	// refusal, so the record in the way is sometimes this acquisition's own.
	// Reporting it as the blocker would strand the very hold it just took.
	if (reading.record.id === acquisition.record.id) {
		return { etag: reading.etag, kind: "acquired" };
	}

	if (reading.record.releasedAt === undefined) {
		return { blocker: holderOf(reading.record), kind: "contended" };
	}

	// The object outlives the hold, because release writes a tombstone
	// rather than deleting it. Taking it over is conditional on the exact
	// bytes that were read, so a run that got there first is not overwritten.
	const takenOver = await writeLockAsync(acquisition, { ifMatch: reading.etag });
	return takenOver.kind === "contended" ? { blocker: undefined, kind: "contended" } : takenOver;
}

/**
 * Refuse to give up a hold the store answered without an entity tag.
 *
 * The tombstone is only safe because it is written against the exact bytes
 * the hold was taken as. With nothing to write against, giving up would
 * mean an unconditional overwrite, which is how a run that took the
 * **Environment** over in the meantime loses its own hold.
 *
 * @param acquisition - The acquisition that won.
 * @returns Why the hold cannot be given up.
 */
function untaggedRelease({ label }: Acquisition): Result<void, StateLockError> {
	const detail: S3StateLockErrorDetail = { file: label, kind: "releaseFailed" };
	return {
		err: {
			detail,
			reason: `${label} was written without an entity tag, so the hold cannot be given up without risking another run's`,
		},
		success: false,
	};
}

/**
 * Stamp one instant the way a lock record carries it.
 *
 * @param ms - Epoch milliseconds the clock read.
 * @returns The instant, in ISO-8601.
 */
function isoAt(ms: number): string {
	const at = new Date(ms);
	return at.toISOString();
}

/**
 * Write the tombstone that gives one hold up.
 *
 * @param acquisition - The acquisition that won.
 * @param etag - Entity tag the store answered the winning write with.
 * @returns `Ok` once the tombstone is stored, or why it was refused.
 */
async function releaseAsync(
	{ key, access, label, record }: Acquisition,
	etag: string,
): Promise<Result<void, StateLockError>> {
	const now = access.deps.now ?? Date.now;

	try {
		await access.client.send(
			new PutObjectCommand({
				Body: serializeLockRecord({ ...record, releasedAt: isoAt(now()) }),
				Bucket: access.deps.bucket,
				ContentType: "application/json",
				IfMatch: etag,
				Key: key,
			}),
		);
		return { data: undefined, success: true };
	} catch (err) {
		const failure = classifyS3Failure(err);
		const detail: S3StateLockErrorDetail = {
			name: failure.name,
			file: label,
			kind: "releaseFailed",
			statusCode: failure.statusCode,
		};
		return { err: { detail, reason: failure.reason }, success: false };
	}
}

/**
 * Hand back the hold, which gives itself up by writing a tombstone over
 * the exact record it took.
 *
 * The lock object is never deleted. Conditional delete is not portable:
 * recent on S3, undocumented on R2, and silently ignored by at least one
 * S3-compatible implementation which deletes anyway and reports success.
 *
 * @param acquisition - The acquisition that won.
 * @param etag - Entity tag the store answered the winning write with.
 * @returns The hold the deploy shell gives up when the work is over.
 */
function grantHold(acquisition: Acquisition, etag: string | undefined): StateLockHold {
	return {
		async release() {
			return etag === undefined
				? untaggedRelease(acquisition)
				: releaseAsync(acquisition, etag);
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
	if (attempt.kind === "failed") {
		const detail: S3StateLockErrorDetail = {
			name: attempt.failure.name,
			file: acquisition.label,
			kind: "acquireFailed",
			statusCode: attempt.failure.statusCode,
		};
		return { err: { detail, reason: attempt.failure.reason }, success: false };
	}

	return { data: grantHold(acquisition, attempt.etag), success: true };
}

/**
 * Report a wait that ran out, naming who held the **Environment** and
 * since when if that was ever readable.
 *
 * @param wait - The acquisition that gave up, the last holder it read, and
 * how long it waited.
 * @returns The failure a caller sees.
 */
function timedOut({ blocker, elapsedMs, label }: TimedOutWait): StateLockError {
	const detail: S3StateLockErrorDetail = {
		elapsedMs,
		file: label,
		holder: blocker,
		kind: "acquireTimedOut",
	};
	const held =
		blocker === undefined
			? "is held by another run"
			: `is held by ${blocker.owner} for ${blocker.operation} since ${blocker.since}`;
	return {
		detail,
		reason: `${label} ${held}; gave up after ${(elapsedMs / 1000).toFixed(1)}s`,
	};
}

/**
 * Wait, on a real timer.
 *
 * @param ms - Milliseconds to wait.
 */
async function delayAsync(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Mint the identity one acquisition records.
 *
 * @returns An identity no other acquisition writes.
 */
function randomId(): string {
	return crypto.randomUUID();
}

/**
 * Open one acquisition over the object that holds the **Environment**'s
 * lock.
 *
 * @param request - The client and coordinates, the **Environment**, and
 * what the hold is for.
 * @returns The acquisition, ready to contend.
 */
function startAcquisition({ access, environment, options }: LockRequest): Acquisition {
	const { deps } = access;
	const key = lockKeyFor(deps.prefix, environment);
	return {
		key,
		access,
		label: objectLabelFor(deps.bucket, key),
		record: {
			id: (deps.mintId ?? randomId)(),
			operation: options.operation ?? DEFAULT_OPERATION,
			owner: deps.owner,
			since: isoAt((deps.now ?? Date.now)()),
		},
	};
}

/**
 * Wait out a hold another run has, taking the **Environment** as soon as
 * the store accepts the conditional create.
 *
 * The retry never depends on being able to read the current holder's
 * record. That read is exactly what fails under contention, and a holder
 * releasing mid-retry has to end in acquisition rather than in the failure
 * a read-first loop would report. The record is read only to name the
 * blocker, to tell this acquisition's own landed write from another run's
 * hold, and to take over the tombstone a release leaves behind.
 *
 * @param request - The client and coordinates, the **Environment**, and
 * where to report the wait.
 * @returns The hold, or why it could not be taken.
 */
async function acquireAsync(request: LockRequest): Promise<Result<StateLockHold, StateLockError>> {
	const { deps } = request.access;
	const now = deps.now ?? Date.now;
	const sleepAsync = deps.sleep ?? delayAsync;
	const timeoutMs = deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
	const startedAt = now();
	const acquisition = startAcquisition(request);

	let blocker: S3LockHolder | undefined;

	for (let attempt = 1; ; attempt += 1) {
		const round = await contendAsync(acquisition);
		if (round.kind !== "contended") {
			return settle(acquisition, round);
		}

		blocker = round.blocker ?? blocker;
		const elapsedMs = now() - startedAt;
		const remainingMs = timeoutMs - elapsedMs;
		if (remainingMs <= 0) {
			return {
				err: timedOut({ blocker, elapsedMs, label: acquisition.label }),
				success: false,
			};
		}

		request.options.onWaiting?.({ elapsedMs, holder: blocker?.owner, remainingMs });
		await sleepAsync(backoffDelayMs({ attempt, remainingMs }));
	}
}
