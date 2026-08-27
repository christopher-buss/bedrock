import {
	GetObjectCommand,
	PutObjectCommand,
	type PutObjectCommandInput,
	type S3Client,
} from "@aws-sdk/client-s3";
import {
	type BedrockState,
	parseStateFile,
	type Result,
	serializeStateFile,
	type StateError,
	type StatePort,
	type StateRecord,
	type StateVersion,
	validateEnvironmentName,
} from "@bedrock-rbx/core";

import { classifyS3Failure, type S3Failure, type S3FailureKind } from "./classify-failure.ts";
import { objectKeyFor, objectLabelFor } from "./object-key.ts";
import { createConfiguredS3Client, readObjectTextAsync, type S3StoreDeps } from "./s3-client.ts";

/**
 * Module specifier a failure this **Backend** produces is attributed to,
 * so a report names the plugin that owns the payload it carries.
 */
const SPECIFIER = "@bedrock-rbx/state-s3";

// Which refusals are conditions any **Backend** has, and so belong in
// core's own vocabulary rather than in this plugin's opaque payload.
const NEUTRAL_STATE_ERROR: Partial<Record<S3FailureKind, NeutralStateErrorKind>> = {
	accessDenied: "stateAccessDenied",
	conditionRefused: "stateConflict",
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
	readonly deps: S3StoreDeps;
}

/**
 * Everything one conditional write needs: the snapshot, the record it is
 * fenced against, and where to send it.
 */
interface WriteObjectInputs {
	/**
	 * What the caller's read observed, absent when the write is
	 * unconditional.
	 */
	readonly expected: StateVersion | undefined;
	/** The snapshot to persist. */
	readonly state: BedrockState;
	/** The configured client and the bucket coordinates. */
	readonly store: BucketAccess;
}

/**
 * The `StateError` arms describing a condition any **Backend** has, which
 * this **Backend** reports in core's vocabulary rather than in its own.
 */
type NeutralStateErrorKind = "stateAccessDenied" | "stateConflict" | "stateNotFound";

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
 *         expect(state.data.state).toBeUndefined();
 *     }
 * });
 * ```
 *
 * @param deps - Bucket coordinates plus the credential and transport
 * seams.
 * @returns A `StatePort` ready to be handed to a **Deploy**.
 */
export function createS3StateAdapter(deps: S3StoreDeps): StatePort {
	const store: BucketAccess = { client: createConfiguredS3Client(deps), deps };

	return {
		async read(environment) {
			const safe = validateEnvironmentName(environment);
			if (!safe.success) {
				return safe;
			}

			return readObjectAsync(store, safe.data);
		},
		async write(state, expected) {
			const safe = validateEnvironmentName(state.environment);
			if (!safe.success) {
				return safe;
			}

			return writeObjectAsync({ expected, state, store });
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
 * Read the entity tag the store answered a `GET` with as the version
 * naming that record.
 *
 * A store that answered without one is refused rather than read as a
 * record carrying no version: that reading would leave the write that
 * follows unfenced, and a **State** write that silently overwrites a
 * record it never saw is what the version exists to prevent.
 *
 * @param etag - Entity tag the store attached, absent when it attached
 * none.
 * @param file - The object the tag was expected on.
 * @returns The version, or the refusal, typed.
 */
function versionOf(etag: string | undefined, file: string): Result<StateVersion, StateError> {
	if (etag === undefined) {
		return {
			err: { file, kind: "stateError", reason: "the store answered without an entity tag" },
			success: false,
		};
	}

	return { data: { kind: "present", token: etag }, success: true };
}

/**
 * Read one **Environment**'s **State** out of the bucket.
 *
 * @param store - The configured client and the bucket coordinates.
 * @param environment - Name of the **Environment** to read.
 * @returns The stored **State** and the version naming that record, a
 * record holding no **State** when the **Environment** has never been
 * deployed, or the refusal, typed.
 */
async function readObjectAsync(
	{ client, deps }: BucketAccess,
	environment: string,
): Promise<Result<StateRecord, StateError>> {
	const key = objectKeyFor(deps.prefix, environment);
	const label = objectLabelFor(deps.bucket, key);

	try {
		const object = await client.send(new GetObjectCommand({ Bucket: deps.bucket, Key: key }));
		const parsed = parseStateFile(await readObjectTextAsync(object.Body), label);
		if (!parsed.success) {
			return parsed;
		}

		const version = versionOf(object.ETag, label);
		if (!version.success) {
			return version;
		}

		return { data: { state: parsed.data, version: version.data }, success: true };
	} catch (err) {
		const failure = classifyS3Failure(err);
		if (failure.kind === "missingObject") {
			return { data: { version: { kind: "absent" } }, success: true };
		}

		return { err: toStateError(failure, label), success: false };
	}
}

/**
 * Turn the version a caller read into the precondition the `PUT` carries.
 *
 * The wildcard is sent bare, never quoted: at least one S3-compatible
 * store compares the raw header value before stripping quotes, so a
 * quoted wildcard falls through to an entity-tag comparison, the
 * condition reads as satisfied, and the create-if-absent degrades into an
 * unconditional overwrite.
 *
 * @param expected - What the caller's read observed, absent when the
 * write is unconditional.
 * @returns The command fields carrying the precondition, empty when there
 * is none.
 */
function conditionFor(
	expected: StateVersion | undefined,
): Pick<PutObjectCommandInput, "IfMatch" | "IfNoneMatch"> {
	if (expected === undefined) {
		return {};
	}

	return expected.kind === "absent" ? { IfNoneMatch: "*" } : { IfMatch: expected.token };
}

/**
 * Read what a conditional `PUT` was refused with, in the terms this
 * **Backend** owns.
 *
 * A `PUT` fenced on an entity tag is answered with the absent-object code
 * when the record has been deleted since it was read, which is the same
 * condition as a tag that no longer agrees: the record the caller read is
 * gone. It is read as a conflict on this path only, so a `GET` of an
 * **Environment** that has never been deployed still reads as an ordinary
 * first **Deploy**.
 *
 * @param failure - The refusal, already classified.
 * @param expected - What the caller's read observed, absent when the
 * write is unconditional.
 * @returns The refusal, with the write path's reading applied.
 */
function refusalOf(failure: S3Failure, expected: StateVersion | undefined): S3Failure {
	const deleted = failure.kind === "missingObject" && expected?.kind === "present";
	return deleted ? { ...failure, kind: "conditionRefused" } : failure;
}

/**
 * Write one **Environment**'s **State** into the bucket, fenced against
 * the record the caller read.
 *
 * @param inputs - The snapshot to persist, what the caller's read
 * observed, and the client and bucket coordinates to send it through.
 * @returns `Ok` once the object is stored, the conflict when the record
 * moved, or the refusal, typed.
 */
async function writeObjectAsync({
	expected,
	state,
	store: { client, deps },
}: WriteObjectInputs): Promise<Result<void, StateError>> {
	const key = objectKeyFor(deps.prefix, state.environment);
	const label = objectLabelFor(deps.bucket, key);

	try {
		await client.send(
			new PutObjectCommand({
				...conditionFor(expected),
				Body: serializeStateFile(state),
				Bucket: deps.bucket,
				ContentType: "application/json",
				Key: key,
			}),
		);
		return { data: undefined, success: true };
	} catch (err) {
		return {
			err: toStateError(refusalOf(classifyS3Failure(err), expected), label),
			success: false,
		};
	}
}
