// Segment the lock objects live under, so a bucket lifecycle rule can
// expire them by prefix without reaching the **State** objects.
const LOCK_SEGMENT = "locks";

/**
 * Map one **Environment** onto the object that holds its **State**.
 *
 * One object per **Environment** is what keeps two environments deploying
 * at once out of contention: they address different keys, so neither
 * write can land on the other's record.
 *
 * The prefix is read as a folder path however it was written, so
 * `bedrock/state`, `/bedrock/state`, and `bedrock/state/` all place the
 * object in the same place. A key never opens with a separator, which S3
 * would otherwise keep as an empty leading path segment.
 * @param prefix - Configured prefix, or `undefined` to store at the
 * bucket root.
 * @param environment - Name of the **Environment** the **State** belongs
 * to.
 * @returns The object key holding that **Environment**'s **State**.
 */
export function objectKeyFor(prefix: string | undefined, environment: string): string {
	const segments = (prefix ?? "").split("/").filter((segment) => segment !== "");
	return [...segments, `${environment}.json`].join("/");
}

/**
 * Map one **Environment** onto the object that holds its lock.
 *
 * Locks sit under their own segment beneath the prefix rather than beside
 * the **State** objects, because a bucket lifecycle rule filters by prefix
 * and cannot filter by suffix: keeping them apart is what lets an operator
 * expire abandoned holds without touching **State**.
 * @param prefix - Configured prefix, or `undefined` to store at the
 * bucket root.
 * @param environment - Name of the **Environment** the hold covers.
 * @returns The object key holding that **Environment**'s lock.
 */
export function lockKeyFor(prefix: string | undefined, environment: string): string {
	return objectKeyFor(`${prefix ?? ""}/${LOCK_SEGMENT}`, environment);
}

/**
 * Address one object the way an operator would write it, so a failure
 * names something they can paste into the AWS CLI.
 * @param bucket - Bucket the object lives in.
 * @param key - Object key within that bucket.
 * @returns The `s3://` URI naming the object.
 */
export function objectLabelFor(bucket: string, key: string): string {
	return `s3://${bucket}/${key}`;
}
