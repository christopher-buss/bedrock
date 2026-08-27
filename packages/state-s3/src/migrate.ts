import { GetObjectCommand } from "@aws-sdk/client-s3";
import type {
	Result,
	StateBackendBuildError,
	StateBackendMigrateSource,
	StateBackendPromptField,
	StateBackendSourceContext,
} from "@bedrock-rbx/core";

import { type } from "arktype";

import { classifyS3Failure } from "./classify-failure.ts";
import { credentialsFrom } from "./credentials.ts";
import { objectLabelFor } from "./object-key.ts";
import { createConfiguredS3Client, readObjectTextAsync } from "./s3-client.ts";
import type { S3StateErrorDetail } from "./s3-state-adapter.ts";

// A key present but blank is a coordinate the user never gave, which
// would otherwise reach the client as an object nothing is stored at.
const NON_EMPTY_STRING = "string > 0";

// What mantle appends to the project name to name the object its state
// lives in, which is the only naming convention a bucket it wrote holds.
const MANTLE_STATE_SUFFIX = ".mantle-state.yml";

// The coordinates mantle's own `state.remote` block names, which is what
// the source's prompts collect. The custom-region form an S3-compatible
// store is reached through arrives flattened: its `name` is the region and
// its `endpoint` the endpoint.
const mantleCoordinates = type({
	"key": NON_EMPTY_STRING,
	"bucket": NON_EMPTY_STRING,
	"endpoint?": NON_EMPTY_STRING,
	"region": NON_EMPTY_STRING,
});

/**
 * Where one mantle state object lives, read out of the coordinates the
 * user answered with.
 */
interface MantleStateLocation {
	/** Key the object is stored under. */
	readonly key: string;
	/** Bucket the object lives in. */
	readonly bucket: string;
	/** Endpoint to address instead of AWS, absent for AWS itself. */
	readonly endpoint: string | undefined;
	/** Project name mantle keyed the object by. */
	readonly project: string;
	/** Region the bucket lives in. */
	readonly region: string;
}

/**
 * Fields `bedrock migrate` asks for when a user writes their migrated
 * **State** into a bucket. They are the `state` keys a **Deploy** needs,
 * asked in the order a user reads them off their bucket.
 */
export const s3MigratePrompts: ReadonlyArray<StateBackendPromptField> = [
	{
		key: "bucket",
		label: "Bucket to store state in?",
		placeholder: "my-bucket",
		validationMessage: "A bucket is required",
	},
	{
		key: "region",
		label: "Region the bucket lives in?",
		placeholder: "eu-west-2",
		validationMessage: "A region is required",
	},
	{
		key: "endpoint",
		label: "Endpoint to address instead of AWS? (leave empty for AWS)",
		placeholder: "https://<account>.r2.cloudflarestorage.com",
	},
];

/**
 * How `bedrock migrate` reads a mantle state object out of the bucket it
 * has always lived in, so a user whose state was never on disk migrates
 * without downloading it first.
 *
 * The coordinates are mantle's own `state.remote` block, asked field by
 * field: the bucket, the project name it keyed the object with, the
 * region, and the endpoint its custom-region form names for an
 * S3-compatible store.
 */
export const s3MigrateSource: StateBackendMigrateSource = {
	prompts: [
		{
			key: "bucket",
			label: "Bucket the Mantle state lives in?",
			placeholder: "my-mantle-states",
			validationMessage: "A bucket is required",
		},
		{
			key: "region",
			label: "Region the bucket lives in?",
			placeholder: "us-west-2",
			validationMessage: "A region is required",
		},
		{
			key: "key",
			label: "Key Mantle stored the state under (its `state.remote.key`)?",
			placeholder: "pirate-wars",
			validationMessage: "A key is required",
		},
		{
			key: "endpoint",
			label: "Endpoint to address instead of AWS? (leave empty for AWS)",
			placeholder: "https://<account>.r2.cloudflarestorage.com",
		},
	],
	readBytes: async (context) => readMantleStateAsync(context),
	toStateConfig: (coordinates) => {
		const located = locateMantleState(coordinates);
		if (!located.success) {
			throw new TypeError(located.err.reason);
		}

		return stateConfigFrom(located.data);
	},
};

/**
 * Translate where mantle kept its state into the `state` keys a **Deploy**
 * through this **Backend** reads.
 *
 * The project name mantle keyed its object by becomes the prefix the
 * **Environment** objects are written under, so two projects that shared
 * one bucket under mantle stay apart under bedrock rather than both
 * writing `production.json` at the root.
 *
 * @param located - Where the mantle state was read from.
 * @returns The `state` keys to record, which core writes `backend`
 * alongside.
 */
function stateConfigFrom({
	bucket,
	endpoint,
	project,
	region,
}: MantleStateLocation): Readonly<Record<string, unknown>> {
	return {
		bucket,
		prefix: project,
		region,
		...(endpoint === undefined ? {} : { endpoint }),
	};
}

/**
 * Read where the mantle state object lives out of the coordinates the
 * user answered with.
 *
 * The key is the project name mantle was configured with, which it names
 * the object `<project>.mantle-state.yml` after. A user who answers with
 * the object name they read off their bucket console names the same
 * object, rather than one carrying the suffix twice.
 *
 * @param coordinates - The answered coordinates.
 * @returns The location, or the refusal naming what the coordinates left
 * out.
 */
function locateMantleState(
	coordinates: Readonly<Record<string, string>>,
): Result<MantleStateLocation, StateBackendBuildError> {
	const parsed = mantleCoordinates(coordinates);
	if (parsed instanceof type.errors) {
		return {
			err: {
				detail: coordinates,
				reason: `the Mantle state coordinates are incomplete: ${parsed.summary}`,
			},
			success: false,
		};
	}

	const project = parsed.key.endsWith(MANTLE_STATE_SUFFIX)
		? parsed.key.slice(0, -MANTLE_STATE_SUFFIX.length)
		: parsed.key;
	return {
		data: {
			key: `${project}${MANTLE_STATE_SUFFIX}`,
			bucket: parsed.bucket,
			endpoint: parsed.endpoint,
			project,
			region: parsed.region,
		},
		success: true,
	};
}

/**
 * Fetch the bytes of the mantle state object the coordinates name.
 *
 * Credentials resolve exactly as they do for a **Deploy**: the key pair
 * the environment core injected holds, and the standard AWS Node chain
 * when it holds none.
 *
 * @param context - The answered coordinates plus the credential seam core
 * injects.
 * @returns The object's bytes, or the refusal naming the object and what
 * the store said about it.
 */
async function readMantleStateAsync({
	coordinates,
	getEnv: getEnvironment,
}: StateBackendSourceContext): Promise<Result<Uint8Array, StateBackendBuildError>> {
	const located = locateMantleState(coordinates);
	if (!located.success) {
		return located;
	}

	const { key, bucket, endpoint, region } = located.data;
	const client = createConfiguredS3Client({
		bucket,
		credentials: credentialsFrom(getEnvironment),
		endpoint,
		region,
	});
	const encoder = new TextEncoder();

	try {
		const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
		const text = await readObjectTextAsync(object.Body);
		return { data: encoder.encode(text), success: true };
	} catch (err) {
		const failure = classifyS3Failure(err);
		const detail: S3StateErrorDetail = {
			name: failure.name,
			kind: failure.kind,
			statusCode: failure.statusCode,
		};
		return {
			err: { detail, reason: `${objectLabelFor(bucket, key)}: ${failure.reason}` },
			success: false,
		};
	}
}
