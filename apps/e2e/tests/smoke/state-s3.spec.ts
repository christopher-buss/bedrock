import {
	asSha256Hex,
	type BedrockState,
	deploy,
	type DriverRegistry,
	loadProjectAsync,
	OpenCloudError,
	parseStateFile,
	type StateBackendFetch,
} from "@bedrock-rbx/core";
import {
	createS3StateAdapter,
	createS3StateLockPort,
	type S3StateLockAdapterDeps,
} from "@bedrock-rbx/state-s3";

import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it, onTestFinished } from "vitest";

import { assertOk } from "../helpers/assert-ok.ts";
import { pruneStateS3Async } from "../helpers/prune-state-s3.ts";
import {
	deleteS3ObjectAsync,
	headS3ObjectAsync,
	readS3ObjectTextAsync,
} from "../helpers/s3-object.ts";
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

// A digest the moving write stamps so its bytes, and so the object's
// entity tag, differ from what the first write left.
const MOVED_DIGEST = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** One request the bucket answered, as it went over the wire. */
interface AnsweredRequest {
	/** The absent-object condition the request carried, `-` for none. */
	readonly ifNoneMatch: string;
	/** HTTP method the client used. */
	readonly method: string;
	/** Object path the request addressed. */
	readonly path: string;
	/** Status the bucket answered with. */
	readonly status: number;
}

/**
 * Build a lock port over the smoke bucket, on the credentials the runner
 * already carries.
 *
 * @param deps - What one acquisition configures beyond the bucket: how
 * long it waits out a hold, how long its own hold is leased for, the
 * schedule it renews that lease on, the transport it is watched through,
 * and the identity it mints.
 * @returns The lock port to take a hold with.
 */
function lockPort(deps: Partial<S3StateLockAdapterDeps> = {}) {
	return createS3StateLockPort({
		bucket: BUCKET,
		owner: "bedrock-smoke",
		prefix: PREFIX,
		region: REGION,
		...deps,
	});
}

/**
 * Wait, so a lease taken out over the bucket has time to run out.
 *
 * @param ms - Milliseconds to wait.
 */
async function waitAsync(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Record what the bucket was asked and what it answered, on the real
 * transport, so a test can state what AWS itself did with a condition.
 *
 * @param calls - Where to record each request and its answer.
 * @returns The transport to hand the lock port.
 */
function recording(calls: Array<AnsweredRequest>): StateBackendFetch {
	return async (input, init) => {
		const answered = await fetch(input, init);
		const addressed = new Request(input);
		const url = new URL(addressed.url);
		const sent = new Headers(init?.headers);
		calls.push({
			ifNoneMatch: sent.get("if-none-match") ?? "-",
			method: init?.method ?? "GET",
			path: url.pathname,
			status: answered.status,
		});
		return answered;
	};
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
			const contended = await lockPort({ lockTimeoutMs: 0 }).acquire(environment);

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
			const again = await lockPort({ lockTimeoutMs: 0 }).acquire(environment);

			expect(again.success).toBeTrue();
		},
		60_000,
	);

	it.skipIf(!HAS_SECRETS)(
		"should report who holds an environment and take that hold away",
		async () => {
			expect.assertions(4);

			const environment = `${ENVIRONMENT}-unlock-${Date.now()}`;

			onTestFinished(async () => {
				await pruneStateS3Async({
					bucket: BUCKET,
					keep: KEEP,
					prefix: PREFIX,
					region: REGION,
				});
			});

			const port = lockPort();
			const hold = await port.acquire(environment, { operation: "smoke" });
			assertOk(hold, "acquire");

			const held = await port.inspect(environment);
			assertOk(held, "inspect");
			assert(held.data !== undefined);

			expect(held.data.owner).toBe("bedrock-smoke");

			const displaced = await port.forceRelease(environment);
			assertOk(displaced, "force release");
			assert(displaced.data !== undefined);

			expect(displaced.data.operation).toBe("smoke");

			// The hold is gone for the next run, and reported as gone to
			// anyone asking, which is what makes this a recovery path
			// rather than a write nobody can act on.
			const after = await port.inspect(environment);
			assertOk(after, "inspect after the hold was taken away");

			expect(after.data).toBeUndefined();

			const taken = await lockPort({ lockTimeoutMs: 0 }).acquire(environment);

			expect(taken.success).toBeTrue();
		},
		60_000,
	);

	it.skipIf(!HAS_SECRETS)(
		"should take over a hold whose lease ran out and refuse what that holder writes next",
		async () => {
			expect.assertions(3);

			const environment = `${ENVIRONMENT}-lease-${Date.now()}`;

			onTestFinished(async () => {
				await pruneStateS3Async({
					bucket: BUCKET,
					keep: KEEP,
					prefix: PREFIX,
					region: REGION,
				});
			});

			// A schedule that never runs is a run killed mid-deploy: the hold
			// is taken, and nothing ever renews the lease on it. The lease is
			// long enough for the bucket to answer the write well inside it,
			// which is what a hold has to outlive to be granted at all.
			const abandoned = await lockPort({
				lockLeaseMs: 5000,
				scheduleEvery: () => () => {},
			}).acquire(environment, { operation: "smoke" });
			assertOk(abandoned, "acquire");

			await waitAsync(5500);

			// No patience at all, so this takes the expired hold over rather
			// than waiting anything out.
			const takeover = await lockPort({ lockTimeoutMs: 0 }).acquire(environment);
			assertOk(takeover, "takeover of an expired hold");

			// The abandoned run is still alive and still thinks it holds the
			// environment. Its tombstone is fenced on the record it took, and
			// the bucket has moved past that.
			const stale = await abandoned.data.release();

			expect(stale.success).toBeFalse();

			const given = await takeover.data.release();
			assertOk(given, "release of the taken-over hold");

			const tombstone = await readS3ObjectTextAsync({
				key: `${PREFIX}/locks/${environment}.json`,
				bucket: BUCKET,
				region: REGION,
			});

			expect(tombstone).toInclude('"releasedAt"');
			expect(tombstone).toInclude('"expiresAt"');
		},
		60_000,
	);

	it.skipIf(!HAS_SECRETS)(
		"should prove the bucket refuses a create of an object it already holds",
		async () => {
			expect.assertions(3);

			// A stamped environment gives every run its own lock object, and
			// a stamped probe its own scratch object, so concurrent runs
			// never contend over either.
			const stamp = Date.now();
			const environment = `${ENVIRONMENT}-probe-${stamp}`;
			const probeId = `smoke-${stamp}`;
			const probeKey = `${PREFIX}/locks/.probe-${probeId}.json`;
			const calls: Array<AnsweredRequest> = [];

			onTestFinished(async () => {
				await pruneStateS3Async({
					bucket: BUCKET,
					keep: KEEP,
					prefix: PREFIX,
					region: REGION,
				});
			});

			// A hold is taken only where the probe passed: a bucket that took
			// the second create is refused before acquisition reaches the
			// lock object at all.
			const hold = await lockPort({
				fetch: recording(calls),
				lockTimeoutMs: 0,
				mintId: () => probeId,
			}).acquire(environment, { operation: "smoke" });

			expect(hold.success).toBeTrue();

			assertOk(hold, "acquire against a bucket that honours conditional creates");

			// What the bucket itself did with the probe: took the scratch
			// object, refused the create of the object it was by then
			// holding, and gave it up again.
			const probed = calls.filter((call) => call.path.endsWith(`/${probeKey}`));

			expect(
				probed.map((call) => `${call.method} ${call.ifNoneMatch} ${call.status}`),
			).toStrictEqual(["PUT - 200", "PUT * 412", "DELETE - 204"]);

			// Nothing the probe wrote outlives it.
			await expect(
				headS3ObjectAsync({ key: probeKey, bucket: BUCKET, region: REGION }),
			).rejects.toMatchObject({ name: "NotFound" });
		},
		60_000,
	);

	it.skipIf(!HAS_SECRETS)(
		"should refuse a write fenced on a record the bucket has moved past",
		async () => {
			expect.assertions(3);

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

			const lostOnAbsence = await port.write(state, first.data.version);
			assert(!lostOnAbsence.success);

			expect(lostOnAbsence.err.kind).toBe("stateConflict");

			// The steady-state arm: a stale entity tag, which the bucket
			// evaluates rather than the create-if-absent wildcard.
			const stale = await port.read(environment);
			assertOk(stale, "read of the record the first write left");

			// Different bytes, so the object's entity tag moves with it.
			const moved = await port.write(
				{ ...state, codegenHash: asSha256Hex(MOVED_DIGEST) },
				stale.data.version,
			);
			assertOk(moved, "a write that moves the record on");

			const lostOnTag = await port.write(state, stale.data.version);
			assert(!lostOnTag.success);

			expect(lostOnTag.err.kind).toBe("stateConflict");
		},
		60_000,
	);

	it.skipIf(!HAS_SECRETS)(
		"should refuse a write fenced on a record the bucket no longer holds",
		async () => {
			expect.assertions(2);

			const environment = `${ENVIRONMENT}-deleted-${Date.now()}`;
			const key = `${PREFIX}/${environment}.json`;
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

			const first = await port.write(state, { kind: "absent" });
			assertOk(first, "the first write fenced on an absent record");

			const read = await port.read(environment);
			assertOk(read, "read of the record the first write left");

			assert(read.data.version !== undefined);

			expect(read.data.version.kind).toBe("present");

			// The record the read named is gone by the time the write lands,
			// which the bucket answers with the absent-object code rather than
			// the `412` a disagreeing entity tag gets.
			await deleteS3ObjectAsync({ key, bucket: BUCKET, region: REGION });

			const lost = await port.write(state, read.data.version);
			assert(!lost.success);

			expect(lost.err.kind).toBe("stateConflict");
		},
		60_000,
	);
});
