import {
	type BedrockState,
	deploy,
	type DriverRegistry,
	loadProjectAsync,
	OpenCloudError,
	parseStateFile,
} from "@bedrock-rbx/core";
import { createS3StateAdapter, createS3StateLockPort } from "@bedrock-rbx/state-s3";

import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it, onTestFinished } from "vitest";

import { assertOk } from "../helpers/assert-ok.ts";
import { pruneStateS3Async } from "../helpers/prune-state-s3.ts";
import { headS3ObjectAsync, readS3ObjectTextAsync } from "../helpers/s3-object.ts";
import { BUCKET, ENVIRONMENT, PREFIX, REGION } from "./fixtures/state-s3/coordinates.ts";

// Both halves must be present and non-empty. Given one, the AWS default
// provider carries on to the rest of the chain and queries EC2 instance
// metadata, which on a runner outside AWS only fails after a wait. An unset
// GitHub secret reaches the process as an empty string, not as absent.
const HAS_SECRETS = [process.env["AWS_ACCESS_KEY_ID"], process.env["AWS_SECRET_ACCESS_KEY"]].every(
	(value) => value !== undefined && value !== "",
);

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "state-s3");

// How many past runs stay in the bucket to be read by hand.
const KEEP = 3;

/**
 * Build a lock port over the smoke bucket, on the credentials the runner
 * already carries.
 *
 * @param lockTimeoutMs - How long acquisition waits out a hold; omit to
 * wait the default five minutes.
 * @returns The lock port to take a hold with.
 */
function lockPort(lockTimeoutMs?: number) {
	return createS3StateLockPort({
		bucket: BUCKET,
		lockTimeoutMs,
		owner: "bedrock-smoke",
		prefix: PREFIX,
		region: REGION,
	});
}

/**
 * A registry whose drivers all refuse. A deploy that succeeds against it
 * touched nothing but the bucket.
 *
 * @returns The registry to hand the **Deploy**.
 */
function refusingRegistry(): DriverRegistry {
	async function refuseAsync(): Promise<{ err: OpenCloudError; success: false }> {
		return { err: new OpenCloudError("no resource is declared here"), success: false };
	}

	return {
		developerProduct: { create: refuseAsync },
		gamePass: { create: refuseAsync },
		place: { create: refuseAsync },
		universe: { create: refuseAsync },
	};
}

describe("s3 state backend against real aws", () => {
	it.skipIf(!HAS_SECRETS)(
		"should deploy through a config naming the plugin and leave state in the bucket",
		async () => {
			expect.assertions(3);

			// A stamped environment gives every run its own object, so
			// concurrent runs never contend and each deploy is a first
			// deploy into a key holding nothing.
			const environment = `${ENVIRONMENT}-${Date.now()}`;
			const key = `${PREFIX}/${environment}.json`;
			const object = { key, bucket: BUCKET, region: REGION };

			onTestFinished(async () => {
				await pruneStateS3Async({
					bucket: BUCKET,
					keep: KEEP,
					prefix: PREFIX,
					region: REGION,
				});
			});

			const loaded = await loadProjectAsync({ cwd: FIXTURE });
			assertOk(loaded, "loadProjectAsync");

			expect(loaded.data.plugins.stateBackends.has("s3")).toBeTrue();

			const result = await deploy({
				config: { ...loaded.data.config, environments: { [environment]: {} } },
				environment,
				plugins: loaded.data.plugins,
				registry: refusingRegistry(),
			});
			assertOk(result, "deploy");

			const head = await headS3ObjectAsync(object);

			expect(head.ContentType).toBe("application/json");

			const parsed = parseStateFile(await readS3ObjectTextAsync(object), key);
			assertOk(parsed, "parseStateFile");

			expect(parsed.data).toStrictEqual({
				environment,
				resources: [],
				version: 1,
			});
		},
		60_000,
	);

	it.skipIf(!HAS_SECRETS)(
		"should hold the environment against a second run and hand it back on release",
		async () => {
			expect.assertions(4);

			// A stamped environment gives every run its own lock object, so
			// concurrent runs never contend and each acquisition is a first
			// acquisition against a key holding nothing.
			const environment = `${ENVIRONMENT}-lock-${Date.now()}`;

			onTestFinished(async () => {
				await pruneStateS3Async({
					bucket: BUCKET,
					keep: KEEP,
					prefix: PREFIX,
					region: REGION,
				});
			});

			const hold = await lockPort().acquire(environment, { operation: "smoke" });
			assertOk(hold, "acquire");

			// No patience at all, so this refuses on the hold rather than on
			// anything the network did.
			const contended = await lockPort(0).acquire(environment);

			expect(contended.success).toBeFalse();

			const given = await hold.data.release();
			assertOk(given, "release");

			const tombstone = await readS3ObjectTextAsync({
				key: `${PREFIX}/locks/${environment}.json`,
				bucket: BUCKET,
				region: REGION,
			});

			expect(tombstone).toInclude('"operation": "smoke"');
			expect(tombstone).toInclude('"releasedAt"');

			// The object outlives the hold, so the next run has to be able to
			// take it over rather than find the environment blocked forever.
			const again = await lockPort(0).acquire(environment);

			expect(again.success).toBeTrue();
		},
		60_000,
	);

	it.skipIf(!HAS_SECRETS)(
		"should refuse a write fenced on a record the bucket has moved past",
		async () => {
			expect.assertions(2);

			const environment = `${ENVIRONMENT}-conflict-${Date.now()}`;
			const state: BedrockState = { environment, resources: [], version: 1 };

			onTestFinished(async () => {
				await pruneStateS3Async({
					bucket: BUCKET,
					keep: KEEP,
					prefix: PREFIX,
					region: REGION,
				});
			});

			const port = createS3StateAdapter({
				bucket: BUCKET,
				prefix: PREFIX,
				region: REGION,
			});

			const first = await port.read(environment);
			assertOk(first, "read of an environment never deployed");

			expect(first.data.version).toStrictEqual({ kind: "absent" });

			// Two writes fenced on the same absent record: whoever gets there
			// second is the run whose hold was never really held.
			const won = await port.write(state, first.data.version);
			assertOk(won, "the first write fenced on an absent record");

			const lost = await port.write(state, first.data.version);
			assert(!lost.success);

			expect(lost.err.kind).toBe("stateConflict");
		},
		60_000,
	);
});
