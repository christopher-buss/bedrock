/**
 * What went wrong beneath a read or a write, in terms this **Backend**
 * owns rather than in the S3 error codes that produced them.
 *
 * - `conditionRefused` - a conditional write found the object in a state
 *   its condition ruled out, which under a lock is another run holding the
 *   **Environment** rather than a failure.
 * - `missingObject` - the **Environment** has no **State** object yet,
 *   which is an ordinary first **Deploy** rather than a failure.
 * - `missingStore` - the bucket itself does not resolve.
 * - `accessDenied` - a credential reached the store and was refused.
 * - `missingCredentials` - no credential resolved, so nothing was sent.
 * - `requestFailed` - anything else the store or the transport reported.
 *
 * @since unreleased
 */
export type S3FailureKind =
	| "accessDenied"
	| "conditionRefused"
	| "missingCredentials"
	| "missingObject"
	| "missingStore"
	| "requestFailed";

/**
 * One refusal, read into the terms this **Backend** owns while keeping
 * what the client reported so a report can name it.
 */
export interface S3Failure {
	/** Error name the client deserialized, or `Error` when it threw none. */
	readonly name: string;
	/** What the refusal means for reading or writing **State**. */
	readonly kind: S3FailureKind;
	/** Message the store or the transport gave. */
	readonly reason: string;
	/** Status the store answered with, absent when nothing reached it. */
	readonly statusCode: number | undefined;
}

/**
 * The payload a failure only this **Backend** can describe carries, which
 * core passes through untouched.
 *
 * @since unreleased
 */
export interface S3StateErrorDetail {
	/** S3 error code the client read the refusal as. */
	readonly name: string;
	/** What the refusal means for reading or writing **State**. */
	readonly kind: S3FailureKind;
	/** Status the store answered with, absent when nothing reached it. */
	readonly statusCode: number | undefined;
}

// Codes worth reading as something other than a bare request failure.
// Only `NoSuchKey` reads as an absent object, and only by name: it is the
// code a `GET` of a missing object answers with, and reading anything
// looser as absent is how a wrong endpoint or a proxy's own `404` would be
// reported as an **Environment** that has never been deployed.
const KIND_BY_NAME: Readonly<Record<string, S3FailureKind>> = {
	AccessDenied: "accessDenied",
	ConditionalRequestConflict: "conditionRefused",
	CredentialsProviderError: "missingCredentials",
	NoSuchBucket: "missingStore",
	NoSuchKey: "missingObject",
	PreconditionFailed: "conditionRefused",
};

// Status fallback for the codes not named above: a store that refuses the
// credential answers `403` whichever code it chose (`InvalidAccessKeyId`,
// `SignatureDoesNotMatch`, an expired token), and every one of those is
// the same condition.
const KIND_BY_STATUS: Readonly<Record<number, S3FailureKind>> = {
	403: "accessDenied",
};

// The two statuses a conditional write is refused with. They read as a
// refused condition only for a request that carried one: `409` is also how
// a store answers `BucketAlreadyExists` and `OperationAborted`, so a
// request with no condition attached must never be read through them.
const CONDITION_REFUSED_STATUS: ReadonlySet<number> = new Set([409, 412]);

/**
 * Read what the S3 client threw into the terms this **Backend** owns.
 *
 * The name decides first and the status second, and only a name says an
 * object is absent. A status alone never does: `NoSuchBucket` answers
 * `404` too, as does a mistyped endpoint, and reading either as an absent
 * object would report it as an **Environment** that has never been
 * deployed - which is how a **Deploy** re-creates every resource it
 * already owns.
 * @param error - Whatever the client threw.
 * @returns The refusal, classified.
 */
export function classifyS3Failure(error: unknown): S3Failure {
	const thrown = error instanceof Error ? error : new Error(String(error));
	const statusCode = statusOf(error);
	const kind =
		KIND_BY_NAME[thrown.name] ??
		(statusCode === undefined ? undefined : KIND_BY_STATUS[statusCode]) ??
		"requestFailed";

	return { name: thrown.name, kind, reason: thrown.message, statusCode };
}

/**
 * Whether one refusal is the store declining the condition a conditional
 * write carried, which under a lock is another run holding the
 * **Environment** rather than a failure.
 *
 * The name decides first, and the status only stands in for the names the
 * client does not model as exception classes. Read this only against a
 * request that actually carried a condition: `409` answers conditions that
 * were never sent as well.
 * @param failure - The refusal, already classified.
 * @returns `true` when the store refused the condition.
 */
export function isConditionRefusal(failure: S3Failure): boolean {
	return (
		failure.kind === "conditionRefused" ||
		(failure.statusCode !== undefined && CONDITION_REFUSED_STATUS.has(failure.statusCode))
	);
}

/**
 * Read one refusal into the payload a caller narrows on, which is what a
 * **Deploy** and a migration both report their failures with.
 *
 * @param failure - The refusal, already classified.
 * @returns The payload to carry alongside the reason.
 */
export function detailOf(failure: S3Failure): S3StateErrorDetail {
	return { name: failure.name, kind: failure.kind, statusCode: failure.statusCode };
}

/**
 * Read the HTTP status the client recorded alongside the error, which is
 * absent when the request never reached the store.
 *
 * Each hop is boxed with `Object()` first, so nothing thrown - a string, a
 * bare error carrying no metadata - reaches `Reflect.get` in a shape it
 * would throw on.
 *
 * @param error - Whatever the client threw.
 * @returns The status, or `undefined` when the error carries none.
 */
function statusOf(error: unknown): number | undefined {
	const metadata = Reflect.get(Object(error), "$metadata");
	const status = Reflect.get(Object(metadata), "httpStatusCode");
	return typeof status === "number" ? status : undefined;
}
