import type { S3Client } from "@aws-sdk/client-s3";
import {
	type Result,
	type StateLockError,
	type StateLockHold,
	type StateLockPort,
	validateEnvironmentName,
} from "@bedrock-rbx/core";

import { backoffDelayMs } from "./backoff.ts";
import { holdWithRenewedLease } from "./lease-renewal.ts";
import { DEFAULT_LOCK_LEASE_MS, isLeaseExpired } from "./lease.ts";
import {
	acquireRefused,
	holdWithoutEntityTag,
	invalidEnvironment,
	leaseAlreadyRunOut,
	timedOut,
} from "./lock-failure.ts";
import {
	type Acquisition,
	discardOwnAsync,
	type LockSeams,
	readLockAsync,
	type SettledAttempt,
	takeOverAsync,
	writeLockAsync,
} from "./lock-object.ts";
import { holderOf, randomLockId, type S3LockHolder, type S3LockRecord } from "./lock-record.ts";
import { lockKeyFor, objectLabelFor } from "./object-key.ts";
import { createConfiguredS3Client, type S3StoreDeps } from "./s3-client.ts";

/**
 * How long acquisition waits out contention before giving up, when the
 * config names no bound of its own.
 *
 * @since unreleased
 */
export const DEFAULT_LOCK_TIMEOUT_MS = 300_000;

// What a hold is recorded as being for when the caller names no operation.
const DEFAULT_OPERATION = "deploy";

/**
 * Everything {@link createS3StateLockPort} needs beyond the bucket it
 * shares with the **State port**.
 *
 * @since unreleased
 */
export interface S3StateLockAdapterDeps extends S3StoreDeps {
	/**
	 * How long a hold is leased for before a waiting deploy may take it
	 * over, in milliseconds. Defaults to {@link DEFAULT_LOCK_LEASE_MS}. The
	 * hold renews the lease while the deploy runs.
	 */
	readonly lockLeaseMs?: number | undefined;
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
	/**
	 * Starts the repeating schedule a hold renews its **Lease** on,
	 * handing back what cancels it. Defaults to an interval timer.
	 */
	readonly scheduleEvery?: ((ms: number, run: () => Promise<void>) => () => void) | undefined;
	/** Waits between attempts. Defaults to a timer. */
	readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** What one round of contention learned about who holds the **Environment**. */
interface HolderReading {
	/** Who holds it, absent when the round found nobody it could name. */
	readonly holder: S3LockHolder | undefined;
	/** Whether the round learned who holds it at all. */
	readonly identified: boolean;
}

/** What one round of contention ended in. */
type ContendOutcome =
	| SettledAttempt
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

/** What {@link settle} needs to read one settled attempt. */
interface SettleInputs {
	/** The acquisition in progress. */
	readonly acquisition: Acquisition;
	/** What the store answered. */
	readonly attempt: SettledAttempt;
	/** Where a **Lease** the hold could not keep is reported. */
	readonly options: AcquireOptions;
}

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
 * Start a repeating schedule, on a real timer.
 *
 * Exported for direct coverage of the timer itself, which a test driving
 * renewal on an injected schedule cannot observe.
 *
 * @param ms - Milliseconds between runs.
 * @param run - What to run each time.
 * @returns What cancels the schedule.
 */
export function intervalEvery(ms: number, run: () => Promise<void>): () => void {
	const timer = setInterval(() => {
		run().catch(() => {
			// The work reports its own outcome, and nothing here can act on
			// a rejection the timer would otherwise end the process over.
		});
	}, ms);
	return () => {
		clearInterval(timer);
	};
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
		leaseMs: deps.lockLeaseMs ?? DEFAULT_LOCK_LEASE_MS,
		mintId: deps.mintId ?? randomLockId,
		now: deps.now ?? Date.now,
		scheduleEvery: deps.scheduleEvery ?? intervalEvery,
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
		claim: {
			id: seams.mintId(),
			operation: operation ?? DEFAULT_OPERATION,
			owner: deps.owner,
		},
		client,
		label: objectLabelFor(deps.bucket, key),
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
 * Settle a create the store accepted without naming an entity tag.
 *
 * The record is on the object either way, so it is read back for the tag
 * the write did not carry. A read that names one settles the hold; a read
 * that names none leaves a record only this acquisition can take away. A
 * record some other run wrote is left where it is.
 *
 * @param acquisition - The acquisition in progress.
 * @param written - The record the create put on the object.
 * @returns The hold, or an acquisition with no entity tag to release.
 */
async function recoverHoldAsync(
	acquisition: Acquisition,
	written: S3LockRecord,
): Promise<SettledAttempt> {
	const found = await readLockAsync(acquisition);
	if (found.kind === "read") {
		if (found.record.id !== acquisition.claim.id) {
			return { etag: undefined, kind: "acquired", record: written };
		}

		if (found.etag !== undefined) {
			return { etag: found.etag, kind: "acquired", record: found.record };
		}
	}

	return discardOwnAsync(acquisition, written);
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
	const { seams } = acquisition;
	const created = await writeLockAsync(acquisition, { kind: "absent" });
	if (created.kind === "acquired") {
		return created.etag === undefined ? recoverHoldAsync(acquisition, created.record) : created;
	}

	if (created.kind === "failed") {
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
	if (found.record.id === acquisition.claim.id) {
		return found.etag === undefined
			? discardOwnAsync(acquisition, found.record)
			: { etag: found.etag, kind: "acquired", record: found.record };
	}

	if (found.record.releasedAt === undefined && !isLeaseExpired(found.record, seams.now())) {
		return contended(holderOf(found.record), true);
	}

	// The object outlives the hold: release writes a tombstone into it, and a
	// run killed mid-deploy leaves a **Lease** nothing renews. The takeover is
	// conditional on the exact bytes that were read, so a run that got there
	// first keeps what it took.
	const takenOver = await takeOverAsync(acquisition, found.etag);
	return takenOver.kind === "contended" ? contended(undefined, true) : takenOver;
}

/**
 * Turn a settled attempt into the hold or the failure a caller sees.
 *
 * @param inputs - The acquisition in progress, what the store answered,
 * and where a **Lease** the hold could not keep is reported.
 * @returns The hold, or why it could not be taken.
 */
function settle({
	acquisition,
	attempt,
	options,
}: SettleInputs): Result<StateLockHold, StateLockError> {
	const { label } = acquisition;

	if (attempt.kind === "failed") {
		return { err: acquireRefused(label, attempt.failure), success: false };
	}

	if (attempt.etag === undefined) {
		return { err: holdWithoutEntityTag(label), success: false };
	}

	if (isLeaseExpired(attempt.record, acquisition.seams.now())) {
		return { err: leaseAlreadyRunOut(label), success: false };
	}

	return {
		data: holdWithRenewedLease({
			acquisition,
			onLeaseLost: options?.onLeaseLost,
			won: { etag: attempt.etag, record: attempt.record },
		}),
		success: true,
	};
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
			return settle({ acquisition, attempt: round, options });
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
