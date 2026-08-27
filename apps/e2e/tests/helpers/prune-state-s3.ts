import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

/**
 * Options controlling a smoke-test state prune.
 */
export interface PruneStateS3Options {
	/** Bucket the smoke **State** objects live in. */
	readonly bucket: string;
	/** Number of newest objects to retain. */
	readonly keep: number;
	/** Folder the smoke **State** objects are written under. */
	readonly prefix: string;
	/** Region the bucket lives in. */
	readonly region: string;
}

/**
 * Compute which object keys should be removed so that at most `keep` remain.
 * Keys are compared lexicographically, which orders the `Date.now()` stamp
 * each smoke run appends oldest-first.
 * @param keys - Every key currently under the smoke prefix.
 * @param keep - How many of the newest keys to retain.
 * @returns The keys that should be deleted, oldest-first.
 */
export function selectKeysToDelete(
	keys: ReadonlyArray<string>,
	keep: number,
): ReadonlyArray<string> {
	const sorted = keys.toSorted();
	const excess = sorted.length - keep;
	return excess <= 0 ? [] : sorted.slice(0, excess);
}

/**
 * Delete all but the newest `keep` smoke **State** objects, leaving the most
 * recent runs in the bucket to be read by hand.
 * @param options - Bucket coordinates and the retention window.
 */
export async function pruneStateS3Async({
	bucket,
	keep,
	prefix,
	region,
}: PruneStateS3Options): Promise<void> {
	const client = new S3Client({ region });
	const listed = await client.send(
		new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/` }),
	);

	const keys = (listed.Contents ?? []).flatMap((object) => {
		return object.Key === undefined ? [] : [object.Key];
	});

	await Promise.all(
		selectKeysToDelete(keys, keep).map(async (key) => {
			await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
		}),
	);
}
