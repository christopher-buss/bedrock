import type { StateLockError } from "@bedrock-rbx/core";

import type { S3Failure } from "./classify-failure.ts";
import type { S3LockHolder } from "./lock-record.ts";

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
 * - `inspectFailed` - who holds the **Environment** could not be read.
 * - `invalidEnvironment` - the **Environment** name could not address an
 *   object.
 * - `conditionalWritesIgnored` - the store took a create of an object it
 *   already held, so a hold there would not exclude anything.
 * - `conditionalWritesUnproven` - the store could not be asked whether it
 *   honours conditional creates, so a hold there rests on nothing.
 * - `leaseLost` - the hold's **Lease** could not be renewed, so the hold
 *   is another run's to take over.
 *
 * @since unreleased
 */
export type S3LockFailureKind =
	| "acquireFailed"
	| "acquireTimedOut"
	| "conditionalWritesIgnored"
	| "conditionalWritesUnproven"
	| "inspectFailed"
	| "invalidEnvironment"
	| "leaseLost"
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

/** One wait that ran out, as it is reported. */
export interface TimedOutWait {
	/** The last holder read, absent when none was. */
	readonly blocker: S3LockHolder | undefined;
	/** How long the wait ran, in milliseconds. */
	readonly elapsedMs: number;
	/** The object the hold is recorded in, as an operator would write it. */
	readonly label: string;
}

/** One refusal, and the object it was answered about. */
interface Refusal {
	/** The refusal, already classified. */
	readonly failure: S3Failure;
	/** What went wrong, in this **Backend**'s terms. */
	readonly kind: S3LockFailureKind;
	/** The object the refusal was answered about. */
	readonly label: string;
}

/**
 * Report an **Environment** name that could not address an object.
 *
 * @param file - The name that was refused.
 * @param reason - What core said was wrong with it.
 * @returns The failure a caller sees.
 */
export function invalidEnvironment(file: string, reason: string): StateLockError {
	const detail: S3StateLockErrorDetail = { file, kind: "invalidEnvironment" };
	return { detail, reason };
}

/**
 * Report a refusal that ended an acquisition.
 *
 * @param label - The object the hold is recorded in.
 * @param failure - The refusal, already classified.
 * @returns The failure a caller sees.
 */
export function acquireRefused(label: string, failure: S3Failure): StateLockError {
	return {
		detail: refusalDetail({ failure, kind: "acquireFailed", label }),
		reason: failure.reason,
	};
}

/**
 * Report a lock record that could not be read at all, which is what a
 * read-only caller asking who holds an **Environment** is told.
 *
 * @param label - The object the hold is recorded in.
 * @param failure - The refusal, already classified.
 * @returns The failure a caller sees.
 */
export function inspectRefused(label: string, failure: S3Failure): StateLockError {
	return {
		detail: refusalDetail({ failure, kind: "inspectFailed", label }),
		reason: failure.reason,
	};
}

/**
 * Report a winning write the store answered without an entity tag.
 *
 * The tombstone that gives a hold up is written against the bytes the hold
 * was taken as, so a hold with nothing to write against is one the caller
 * could never give up safely.
 *
 * @param label - The object the hold would have been recorded in.
 * @returns The failure a caller sees.
 */
export function holdWithoutEntityTag(label: string): StateLockError {
	const detail: S3StateLockErrorDetail = { file: label, kind: "acquireFailed" };
	return {
		detail,
		reason: `${label} was written without an entity tag, so the hold could never be given up safely`,
	};
}

/**
 * Report a hold the store named no entity tag for, which is one no force
 * release can take away safely.
 *
 * The tombstone is written against the bytes the hold was read as, so a
 * hold with nothing to write against would be taken away blind: a deploy
 * that took the **Environment** over between the read and the write would
 * lose the hold it is applying under.
 *
 * @param label - The object the hold is recorded in.
 * @returns The failure a caller sees.
 */
export function displaceWithoutEntityTag(label: string): StateLockError {
	const detail: S3StateLockErrorDetail = { file: label, kind: "releaseFailed" };
	return {
		detail,
		reason: `${label} was read without an entity tag, so the hold could not be taken away without risking a newer one`,
	};
}

/**
 * Report a store that granted the same object to two creates.
 *
 * Named for what it means rather than for the `200` that revealed it: the
 * store evaluated no condition, so every run asking it for this
 * **Environment** would be told it holds one.
 *
 * @param label - The object the hold would have been recorded in.
 * @returns The failure a caller sees.
 */
export function conditionalWritesIgnored(label: string): StateLockError {
	const detail: S3StateLockErrorDetail = { file: label, kind: "conditionalWritesIgnored" };
	return {
		detail,
		reason: `the store holding ${label} took a create of an object it already held, so a hold there would grant two runs the same environment; refusing to lock rather than reporting exclusion this store cannot give`,
	};
}

/**
 * Report a store that could not be asked whether it honours conditional
 * creates.
 *
 * @param label - The object the hold would have been recorded in.
 * @param failure - The refusal that got in the way, already classified.
 * @returns The failure a caller sees.
 */
export function conditionalWritesUnproven(label: string, failure: S3Failure): StateLockError {
	return {
		detail: refusalDetail({ failure, kind: "conditionalWritesUnproven", label }),
		reason: `the store holding ${label} could not be asked whether it honours conditional creates, so exclusion cannot be relied on here; it answered ${failure.name}: ${failure.reason}`,
	};
}

/**
 * Report a hold the store took longer to answer for than the hold is
 * leased for.
 *
 * The deadline is stamped as the write goes out, so a store that answers a
 * whole lease later hands back a hold the next acquisition may take over
 * at once. Refusing it keeps a granted hold one that is actually held.
 *
 * @param label - The object the hold was recorded in.
 * @returns The failure a caller sees.
 */
export function leaseAlreadyRunOut(label: string): StateLockError {
	const detail: S3StateLockErrorDetail = { file: label, kind: "acquireFailed" };
	return {
		detail,
		reason: `${label} was taken under a lease that had already run out by the time the store answered`,
	};
}

/**
 * Report a renewal the store took and named no entity tag for, that a read
 * back could not name one for either.
 *
 * Every write the hold makes is conditional on the bytes of its last one,
 * so a holder that cannot name those bytes can no longer show the store
 * that the **Environment** is still its own.
 *
 * @param label - The object the hold is recorded in.
 * @returns The failure the holder is told its lease is gone with.
 */
export function leaseWithoutEntityTag(label: string): StateLockError {
	const detail: S3StateLockErrorDetail = { file: label, kind: "leaseLost" };
	return {
		detail,
		reason: `${label} was renewed without an entity tag this run could name it by, so the hold can no longer be shown to be its own`,
	};
}

/**
 * Report a **Lease** the store would not let the holder keep.
 *
 * @param label - The object the hold is recorded in.
 * @param failure - The refusal, already classified.
 * @returns The failure the holder is told its lease is gone with.
 */
export function renewRefused(label: string, failure: S3Failure): StateLockError {
	return {
		detail: refusalDetail({ failure, kind: "leaseLost", label }),
		reason: failure.reason,
	};
}

/**
 * Report a tombstone the store refused.
 *
 * @param label - The object the hold is recorded in.
 * @param failure - The refusal, already classified.
 * @returns The failure a caller sees.
 */
export function releaseRefused(label: string, failure: S3Failure): StateLockError {
	return {
		detail: refusalDetail({ failure, kind: "releaseFailed", label }),
		reason: failure.reason,
	};
}

/**
 * Report a wait that ran out, naming who held the **Environment** and
 * since when if that was readable.
 *
 * @param wait - The object waited on, the last holder read, and how long
 * the wait ran.
 * @returns The failure a caller sees.
 */
export function timedOut({ blocker, elapsedMs, label }: TimedOutWait): StateLockError {
	const detail: S3StateLockErrorDetail = {
		elapsedMs,
		file: label,
		holder: blocker,
		kind: "acquireTimedOut",
	};
	const held =
		blocker === undefined
			? "is held by another run"
			: `is held by ${blocker.owner} for ${blocker.operation} since ${blocker.since}, leased until ${blocker.expiresAt}`;
	return {
		detail,
		reason: `${label} ${held}; gave up after ${(elapsedMs / 1000).toFixed(1)}s`,
	};
}

/**
 * Carry one refusal's own terms alongside the object it was answered
 * about, which is what lets a report name the store's code and status
 * without reading them.
 *
 * @param refusal - What went wrong, the refusal itself, and the object it
 * was answered about.
 * @returns The payload a caller reads off the failure.
 */
function refusalDetail({ failure, kind, label }: Refusal): S3StateLockErrorDetail {
	return { name: failure.name, file: label, kind, statusCode: failure.statusCode };
}
