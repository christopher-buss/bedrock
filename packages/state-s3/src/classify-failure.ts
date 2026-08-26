/**
 * What went wrong beneath a read or a write, in terms this **Backend**
 * owns rather than in the S3 error codes that produced them.
 *
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

// Codes worth reading as something other than a bare request failure.
// Only `NoSuchKey` reads as an absent object, and only by name: it is the
// code a `GET` of a missing object answers with, and reading anything
// looser as absent is how a wrong endpoint or a proxy's own `404` would be
// reported as an **Environment** that has never been deployed.
const KIND_BY_NAME: Readonly<Record<string, S3FailureKind>> = {
	AccessDenied: "accessDenied",
	CredentialsProviderError: "missingCredentials",
	NoSuchBucket: "missingStore",
	NoSuchKey: "missingObject",
};

// Status fallback for the codes not named above: a store that refuses the
// credential answers `403` whichever code it chose (`InvalidAccessKeyId`,
// `SignatureDoesNotMatch`, an expired token), and every one of those is
// the same condition.
const KIND_BY_STATUS: Readonly<Record<number, S3FailureKind>> = {
	403: "accessDenied",
};

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
