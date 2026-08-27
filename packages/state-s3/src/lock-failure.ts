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

/** One wait that ran out, as it is reported. */
export interface TimedOutWait {
	/** The last holder read, absent when none was. */
	readonly blocker: S3LockHolder | undefined;
	/** How long the wait ran, in milliseconds. */
	readonly elapsedMs: number;
	/** The object the hold is recorded in, as an operator would write it. */
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
	const detail: S3StateLockErrorDetail = {
		name: failure.name,
		file: label,
		kind: "acquireFailed",
		statusCode: failure.statusCode,
	};
	return { detail, reason: failure.reason };
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
 * Report a tombstone the store refused.
 *
 * @param label - The object the hold is recorded in.
 * @param failure - The refusal, already classified.
 * @returns The failure a caller sees.
 */
export function releaseRefused(label: string, failure: S3Failure): StateLockError {
	const detail: S3StateLockErrorDetail = {
		name: failure.name,
		file: label,
		kind: "releaseFailed",
		statusCode: failure.statusCode,
	};
	return { detail, reason: failure.reason };
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
