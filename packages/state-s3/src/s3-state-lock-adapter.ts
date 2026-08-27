import type { S3Client } from "@aws-sdk/client-s3";
import {
	type Result,
	type StateLockError,
	type StateLockHold,
	type StateLockPort,
	validateEnvironmentName,
} from "@bedrock-rbx/core";

import { backoffDelayMs } from "./backoff.ts";
import {
	type ConditionalWriteProbe,
	type FailedProbe,
	probeConditionalWritesAsync,
	type ProbeTarget,
} from "./conditional-write-probe.ts";
import {
	acquireRefused,
	conditionalWritesIgnored,
	conditionalWritesUnproven,
	holdWithoutEntityTag,
	invalidEnvironment,
	timedOut,
} from "./lock-failure.ts";
import {
	type Acquisition,
	discardOwnAsync,
	type LockSeams,
	readLockAsync,
	releaseAsync,
	type SettledAttempt,
	takeOverAsync,
	type WonHold,
	writeLockAsync,
} from "./lock-object.ts";
import { holderOf, randomLockId, type S3LockHolder, type S3LockRecord } from "./lock-record.ts";
import { lockKeyFor, objectLabelFor, probeKeyFor } from "./object-key.ts";
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
	/** **Environment** the hold covers, as the caller named it. */
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
 * // A store that refuses a create of an object it already holds, which is
 * // what the port proves of one before it takes a hold with it.
 * const stored = new Set<string>();
 *
 * const port = createS3StateLockPort({
 *     bucket: "my-bucket",
 *     credentials: { accessKeyId: "example-access-key", secretAccessKey: "example-secret" },
 *     fetch: async (input, init) => {
 *         const request = new Request(input, init);
 *         if (request.headers.get("if-none-match") === "*" && stored.has(request.url)) {
 *             return new Response("", { status: 412 });
 *         }
 *
 *         stored.add(request.url);
 *         return new Response("", { headers: { etag: '"held"' }, status: 200 });
 *     },
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
	const seams = settleSeams(deps);
	const probeStoreAsync = openProbe({
		key: probeKeyFor(deps.prefix, seams.mintId()),
		bucket: deps.bucket,
		client,
	});

	return {
		async acquire(environment, options) {
			const opened = openAcquisition({
				client,
				deps,
				environment,
				operation: options?.operation,
				seams,
			});
			if (!opened.success) {
				return opened;
			}

			// Asked before anything reaches the lock object: a store that
			// grants two runs the same hold has to be refused rather than
			// answered with one.
			const probed = await probeStoreAsync();
			return probed.kind === "honoured"
				? acquireAsync(opened.data, options)
				: { err: probeRefusal(opened.data.label, probed), success: false };
		},
	};
}

/**
 * Settle the clock, the waiting, and the identity every acquisition
 * through one port runs on.
 *
 * @param deps - What the caller configured, where it configured anything.
 * @returns The seams, defaulted.
 */
function settleSeams(deps: S3StateLockAdapterDeps): LockSeams {
	return {
		mintId: deps.mintId ?? randomLockId,
		now: deps.now ?? Date.now,
		sleepAsync: deps.sleep ?? delayAsync,
		timeoutMs: deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
	};
}

/**
 * Open the standing question of whether this store honours conditional
 * creates, which is asked at most once however many holds are taken.
 *
 * What the store proved is a property of the store rather than of the
 * **Environment** being asked for, so asking again per acquisition would
 * spend a round trip on a question already answered. A round that proved
 * nothing is not an answer and is not held on to: the refusal that got in
 * the way of one acquisition would otherwise refuse every later one on a
 * question the store was never really asked.
 *
 * Two acquisitions racing share the asking rather than each starting one,
 * because they would share the scratch object too: the first probe's
 * cleanup would leave the second's create landing on an absent object,
 * reading a store that honours conditions as one that ignores them. The
 * asking is put away before it is waited on, and taken away again as it
 * settles, so no round can be started while one is still in the air.
 *
 * @param target - The scratch object to write, and the client to write it
 * with.
 * @returns Asking the store, which reaches it once per answer it gets.
 */
function openProbe(target: ProbeTarget): () => Promise<ConditionalWriteProbe> {
	let asking: Promise<ConditionalWriteProbe> | undefined;
	let answered: ConditionalWriteProbe | undefined;

	return async () => {
		if (answered !== undefined) {
			return answered;
		}

		asking ??= probeConditionalWritesAsync(target).then((probed) => {
			asking = undefined;
			answered = probed.kind === "unproven" ? undefined : probed;
			return probed;
		});
		return asking;
	};
}

/**
 * Report a store whose conditional creates cannot be relied on, in terms
 * of what that means for the **Environment** rather than in the store's
 * own.
 *
 * @param label - The object the hold would have been recorded in.
 * @param probed - What the probe learned.
 * @returns The failure a caller sees.
 */
function probeRefusal(label: string, probed: FailedProbe): StateLockError {
	return probed.kind === "ignored"
		? conditionalWritesIgnored(label)
		: conditionalWritesUnproven(label, probed.failure);
}

/**
 * Open one acquisition over the object that holds an **Environment**'s
 * lock.
 *
 * @param inputs - The bucket, the client, the seams, the **Environment**,
 * and what the hold is for.
 * @returns The acquisition ready to contend, or the **Environment** name
 * that could not address an object.
 */
function openAcquisition({
	client,
	deps,
	environment,
	operation,
	seams,
}: AcquisitionInputs): Result<Acquisition, StateLockError> {
	const safe = validateEnvironmentName(environment);
	if (!safe.success) {
		return { err: invalidEnvironment(safe.err.file, safe.err.reason), success: false };
	}

	const key = lockKeyFor(deps.prefix, safe.data);
	return {
		data: {
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
		},
		success: true,
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
 * Hand back the hold, which gives itself up by writing a tombstone over
 * the exact record it took.
 *
 * @param acquisition - The acquisition that won.
 * @param won - The record on the object, and the tag to write against.
 * @returns The hold the deploy shell gives up when the work is over.
 */
function grantHold(acquisition: Acquisition, won: WonHold): StateLockHold {
	return {
		async release() {
			return releaseAsync(acquisition, won);
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
	attempt: SettledAttempt,
): Result<StateLockHold, StateLockError> {
	const { label } = acquisition;

	if (attempt.kind === "failed") {
		return { err: acquireRefused(label, attempt.failure), success: false };
	}

	if (attempt.etag === undefined) {
		return { err: holdWithoutEntityTag(label), success: false };
	}

	return {
		data: grantHold(acquisition, { etag: attempt.etag, record: attempt.record }),
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
