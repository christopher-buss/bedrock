import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
	type BedrockState,
	parseStateFile,
	type Result,
	serializeStateFile,
	type StateError,
	type StatePort,
	validateEnvironmentName,
} from "@bedrock-rbx/core";

import { classifyS3Failure, type S3Failure, type S3FailureKind } from "./classify-failure.ts";
import { objectKeyFor, objectLabelFor } from "./object-key.ts";
import {
	createConfiguredS3Client,
	readObjectTextAsync,
	type S3StateAdapterDeps,
} from "./s3-client.ts";

/**
 * Module specifier a failure this **Backend** produces is attributed to,
 * so a report names the plugin that owns the payload it carries.
 */
const SPECIFIER = "@bedrock-rbx/state-s3";

// Which refusals are conditions any **Backend** has, and so belong in
// core's own vocabulary rather than in this plugin's opaque payload.
const NEUTRAL_STATE_ERROR: Partial<Record<S3FailureKind, NeutralStateErrorKind>> = {
	accessDenied: "stateAccessDenied",
	missingStore: "stateNotFound",
};

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

/**
 * The configured client paired with the coordinates its object keys are
 * built from, which is everything a read or a write needs.
 */
interface BucketAccess {
	/** The configured S3 client. */
	readonly client: S3Client;
	/** Bucket coordinates the object key is built from. */
	readonly deps: S3StateAdapterDeps;
}

/**
 * The `StateError` arms describing a condition any **Backend** has, which
 * this **Backend** reports in core's vocabulary rather than in its own.
 */
type NeutralStateErrorKind = "stateAccessDenied" | "stateNotFound";

/**
 * Build a `StatePort` that persists Bedrock **State** in an S3 bucket,
 * one object per **Environment** under the configured prefix.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { createS3StateAdapter } from "@bedrock-rbx/state-s3";
 *
 * const port = createS3StateAdapter({
 *     bucket: "my-bucket",
 *     credentials: { accessKeyId: "example-access-key", secretAccessKey: "example-secret" },
 *     fetch: async () => new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 }),
 *     region: "eu-west-2",
 * });
 *
 * return port.read("production").then((state) => {
 *     expect(state.success).toBeTrue();
 *     if (state.success) {
 *         expect(state.data).toBeUndefined();
 *     }
 * });
 * ```
 *
 * @param deps - Bucket coordinates plus the credential and transport
 * seams.
 * @returns A `StatePort` ready to be handed to a **Deploy**.
 */
export function createS3StateAdapter(deps: S3StateAdapterDeps): StatePort {
	const store: BucketAccess = { client: createConfiguredS3Client(deps), deps };

	return {
		async read(environment) {
			const safe = validateEnvironmentName(environment);
			if (!safe.success) {
				return safe;
			}

			return readObjectAsync(store, safe.data);
		},
		async write(state) {
			const safe = validateEnvironmentName(state.environment);
			if (!safe.success) {
				return safe;
			}

			return writeObjectAsync(store, state);
		},
	};
}

/**
 * Report one refusal in core's vocabulary, keeping this **Backend**'s own
 * reading of it in the payload core passes through untouched.
 *
 * @param failure - The refusal, already classified.
 * @param file - The object the refusal was about.
 * @returns The `StateError` a caller narrows on.
 */
function toStateError(failure: S3Failure, file: string): StateError {
	const neutral = NEUTRAL_STATE_ERROR[failure.kind];
	if (neutral !== undefined) {
		return { file, kind: neutral, reason: failure.reason };
	}

	const detail: S3StateErrorDetail = {
		name: failure.name,
		kind: failure.kind,
		statusCode: failure.statusCode,
	};
	return {
		detail,
		file,
		kind: "pluginStateBackend",
		reason: failure.reason,
		specifier: SPECIFIER,
	};
}

/**
 * Read one **Environment**'s **State** out of the bucket.
 *
 * @param store - The configured client and the bucket coordinates.
 * @param environment - Name of the **Environment** to read.
 * @returns The stored **State**, `Ok(undefined)` when the
 * **Environment** has never been deployed, or the refusal, typed.
 */
async function readObjectAsync(
	{ client, deps }: BucketAccess,
	environment: string,
): Promise<Result<BedrockState | undefined, StateError>> {
	const key = objectKeyFor(deps.prefix, environment);
	const label = objectLabelFor(deps.bucket, key);

	try {
		const object = await client.send(new GetObjectCommand({ Bucket: deps.bucket, Key: key }));
		return parseStateFile(await readObjectTextAsync(object.Body), label);
	} catch (err) {
		const failure = classifyS3Failure(err);
		if (failure.kind === "missingObject") {
			return { data: undefined, success: true };
		}

		return { err: toStateError(failure, label), success: false };
	}
}

/**
 * Write one **Environment**'s **State** into the bucket, overwriting
 * whatever the last **Deploy** left there.
 *
 * @param store - The configured client and the bucket coordinates.
 * @param state - The snapshot to persist.
 * @returns `Ok` once the object is stored, or the refusal, typed.
 */
async function writeObjectAsync(
	{ client, deps }: BucketAccess,
	state: BedrockState,
): Promise<Result<void, StateError>> {
	const key = objectKeyFor(deps.prefix, state.environment);
	const label = objectLabelFor(deps.bucket, key);

	try {
		await client.send(
			new PutObjectCommand({
				Body: serializeStateFile(state),
				Bucket: deps.bucket,
				ContentType: "application/json",
				Key: key,
			}),
		);
		return { data: undefined, success: true };
	} catch (err) {
		return { err: toStateError(classifyS3Failure(err), label), success: false };
	}
}
