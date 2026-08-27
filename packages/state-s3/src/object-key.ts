// Segment the lock objects live under. A bucket lifecycle rule filters by
// prefix and cannot filter by suffix, so this is the name an operator gives
// a rule that expires abandoned holds.
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
 * Locks live under their own segment beneath the prefix, which is what
 * lets a bucket lifecycle rule expire abandoned holds without reaching the
 * **State** objects.
 * @param prefix - Configured prefix, or `undefined` to store at the
 * bucket root.
 * @param environment - Name of the **Environment** the hold covers.
 * @returns The object key holding that **Environment**'s lock.
 */
export function lockKeyFor(prefix: string | undefined, environment: string): string {
	return objectKeyFor(`${prefix ?? ""}/${LOCK_SEGMENT}`, environment);
}

/**
 * Map one probe onto the scratch object it writes.
 *
 * The scratch object sits beside the lock objects, under the same segment
 * a lifecycle rule expires, so a probe killed before it cleaned up leaves
 * nothing an operator has to notice. The name is dotted and carries the
 * probe's own identity, so it addresses neither a lock nor another probe
 * running at the same time.
 * @param prefix - Configured prefix, or `undefined` to store at the
 * bucket root.
 * @param id - Identity minted for this probe.
 * @returns The object key the probe writes its scratch record at.
 */
export function probeKeyFor(prefix: string | undefined, id: string): string {
	return lockKeyFor(prefix, `.probe-${id}`);
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
