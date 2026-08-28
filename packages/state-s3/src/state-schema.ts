import { type } from "arktype";

// A key present but blank is a misconfiguration, not a default: an empty
// bucket or region would otherwise reach the client and fail as an opaque
// request error rather than as config validation.
const NON_EMPTY_STRING = "string > 0";

/**
 * How the S3 client calculates request checksums, mirroring the AWS SDK's
 * own setting in bedrock's casing.
 *
 * - `whenSupported` adds a checksum to every request that can carry one,
 *   which is what AWS itself expects.
 * - `whenRequired` adds one only where the operation demands it, which is
 *   what an S3-compatible store that rejects the default checksum headers
 *   needs.
 *
 * @since 0.2.0
 */
export type S3ChecksumCalculation = "whenRequired" | "whenSupported";

/**
 * The validated `state` block this **Backend** reads, which is what core
 * hands its builder once the block has been checked against
 * {@link s3StateSchema}.
 *
 * @since 0.2.0
 */
export interface S3StateConfig {
	/** Bucket the **State** objects live in. */
	bucket: string;
	/**
	 * How request checksums are calculated. Defaults to `whenSupported`,
	 * which is what AWS expects; a store that rejects the default checksum
	 * headers needs `whenRequired`.
	 */
	checksumCalculation?: S3ChecksumCalculation;
	/**
	 * Endpoint to address instead of AWS. Best effort: S3-compatible
	 * stores are supported on the strength of the protocol they implement,
	 * and only AWS is tested.
	 */
	endpoint?: string;
	/**
	 * Whether the bucket is addressed as a path segment rather than a
	 * subdomain, which is what most S3-compatible stores serve.
	 */
	forcePathStyle?: boolean;
	/**
	 * How long a hold on an **Environment** is leased for, in milliseconds.
	 * Defaults to one minute, and one second is the shortest accepted: a
	 * lease no round trip fits inside is one every deploy loses its own
	 * hold under. A **Deploy** renews the lease while it runs; a hold
	 * nothing renews past its deadline is taken over by the next deploy,
	 * which is what keeps a cancelled CI job from blocking every later run.
	 */
	lockLeaseMs?: number;
	/**
	 * How long a **Deploy** waits for an **Environment** another run holds
	 * before giving up, in milliseconds. Defaults to five minutes. Zero
	 * refuses immediately rather than waiting at all.
	 */
	lockTimeoutMs?: number;
	/** Folder the **State** objects are written under. */
	prefix?: string;
	/** Region the bucket lives in. */
	region: string;
}

/**
 * The `state` keys this **Backend** adds alongside core's own `backend`,
 * which core merges in when it builds the `state` block's schema.
 *
 * @since 0.2.0
 *
 * @example
 *
 * ```ts
 * import { s3StateSchema } from "@bedrock-rbx/state-s3";
 *
 * const parsed = s3StateSchema({ bucket: "my-bucket", region: "eu-west-2" });
 *
 * expect(parsed).toStrictEqual({ bucket: "my-bucket", region: "eu-west-2" });
 * ```
 */
export const s3StateSchema: type.Any<S3StateConfig> = type({
	"bucket": NON_EMPTY_STRING,
	"checksumCalculation?": "'whenRequired' | 'whenSupported'",
	"endpoint?": NON_EMPTY_STRING,
	"forcePathStyle?": "boolean",
	"lockLeaseMs?": "number >= 1000",
	"lockTimeoutMs?": "number >= 0",
	"prefix?": "string",
	"region": NON_EMPTY_STRING,
});
