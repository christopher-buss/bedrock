import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { HeadObjectCommandOutput } from "@aws-sdk/client-s3";

/** Coordinates of one object in a real bucket. */
export interface S3ObjectRef {
	/** Full object key, prefix included. */
	readonly key: string;
	/** Bucket the object lives in. */
	readonly bucket: string;
	/** Region the bucket lives in. */
	readonly region: string;
}

/**
 * Fetch one object's metadata from S3. A missing object throws the SDK's
 * `NotFound`, which names the bucket and key.
 * @param ref - Bucket, key, and region naming the object.
 * @returns The object's metadata as S3 reports it.
 */
export async function headS3ObjectAsync(ref: S3ObjectRef): Promise<HeadObjectCommandOutput> {
	return clientFor(ref).send(new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.key }));
}

/**
 * Read one object's whole body as text.
 * @param ref - Bucket, key, and region naming the object.
 * @returns Everything the object holds, decoded as text.
 */
export async function readS3ObjectTextAsync(ref: S3ObjectRef): Promise<string> {
	const object = await clientFor(ref).send(
		new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
	);
	return object.Body === undefined ? "" : object.Body.transformToString();
}

function clientFor({ region }: S3ObjectRef): S3Client {
	return new S3Client({ region });
}
