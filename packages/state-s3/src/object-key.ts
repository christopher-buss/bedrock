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
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { objectKeyFor } from "@bedrock-rbx/state-s3";
 *
 * expect(objectKeyFor("bedrock/state", "production")).toBe(
 *     "bedrock/state/production.json",
 * );
 * expect(objectKeyFor(undefined, "production")).toBe("production.json");
 * ```
 *
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
 * Address one object the way an operator would write it, so a failure
 * names something they can paste into the AWS CLI.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { objectLabelFor } from "@bedrock-rbx/state-s3";
 *
 * expect(objectLabelFor("my-bucket", "production.json")).toBe(
 *     "s3://my-bucket/production.json",
 * );
 * ```
 *
 * @param bucket - Bucket the object lives in.
 * @param key - Object key within that bucket.
 * @returns The `s3://` URI naming the object.
 */
export function objectLabelFor(bucket: string, key: string): string {
	return `s3://${bucket}/${key}`;
}
