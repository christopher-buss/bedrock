import type { StateBackendFetch, StateLockWaiting } from "@bedrock-rbx/core";

import { assert, describe, expect, it } from "vitest";

import { createFakeClock } from "#tests/helpers/fake-clock";
import { errorBody, type FakeS3, fakeS3, fakeS3Failure } from "#tests/helpers/fake-s3";
import { parseLockRecord, type S3LockRecord, serializeLockRecord } from "./lock-record.ts";
import {
	createS3StateLockPort,
	DEFAULT_LOCK_TIMEOUT_MS,
	type S3StateLockAdapterDeps,
} from "./s3-state-lock-adapter.ts";

const BUCKET = "my-bucket";
const REGION = "eu-west-2";
const OWNER = "https://github.com/christopher-buss/bedrock/actions/runs/12345";
const THIS_RUN = "this-run";

const LOCK_PATH = "/locks/production.json";
const LOCK_LABEL = "s3://my-bucket/locks/production.json";

const CREDENTIALS = { accessKeyId: "example-access-key", secretAccessKey: "example-secret" };

const OTHER_HOLD: S3LockRecord = {
	id: "other-run",
	operation: "deploy",
	owner: "ci-run-3",
	since: "2026-08-27T09:00:00.000Z",
};

const TEN_O_CLOCK = Date.parse("2026-08-27T10:00:00.000Z");

/**
 * Build the lock port against a fake store, with the credentials a test
 * signs with supplied so signing is exercised without reaching for the
 * ambient AWS environment, and the acquisition identity fixed so a test
 * can state what was written.
 *
 * @param deps - What the test configures beyond bucket, region, and owner.
 * @returns The lock port under test.
 */
function lockFor(deps: Partial<S3StateLockAdapterDeps> & Pick<S3StateLockAdapterDeps, "fetch">) {
	return createS3StateLockPort({
		bucket: BUCKET,
		credentials: CREDENTIALS,
		mintId: () => THIS_RUN,
		owner: OWNER,
		region: REGION,
		...deps,
	});
}

/**
 * Wrap a store so the hold it starts out holding is given up part way
 * through a retry, which is the case a loop that reads the holder first
 * cannot recover from.
 *
 * @param store - The store the requests are served from.
 * @param afterPuts - How many refused writes to let by before the holder
 * releases.
 * @returns The transport to hand the lock port.
 */
function releasingAfter(store: FakeS3, afterPuts: number): StateBackendFetch {
	let puts = 0;
	return async (input, init) => {
		const response = await store.fetchFunc(input, init);
		if (init?.method === "PUT") {
			puts += 1;
			if (puts === afterPuts) {
				store.objects.set(
					LOCK_PATH,
					serializeLockRecord({ ...OTHER_HOLD, releasedAt: "2026-08-27T09:30:00.000Z" }),
				);
			}
		}

		return response;
	};
}

/**
 * Wrap a store so the holder's record can never be read, which is the
 * condition contention itself produces.
 *
 * @param store - The store writes are served from.
 * @returns The transport to hand the lock port.
 */
function unreadableHolder(store: FakeS3): StateBackendFetch {
	return async (input, init) => {
		return init?.method === "PUT"
			? store.fetchFunc(input, init)
			: new Response(errorBody("InternalError", "We encountered an internal error."), {
					status: 500,
				});
	};
}

/**
 * Wrap a store so the holder's record reads once and never again, which
 * is how a wait outlives the one read that named who it is waiting on.
 *
 * @param store - The store the first read and every write are served
 * from.
 * @returns The transport to hand the lock port.
 */
function readableOnce(store: FakeS3): StateBackendFetch {
	let reads = 0;
	return async (input, init) => {
		if (init?.method === "PUT") {
			return store.fetchFunc(input, init);
		}

		reads += 1;
		return reads > 1
			? new Response(errorBody("InternalError", "We encountered an internal error."), {
					status: 500,
				})
			: store.fetchFunc(input, init);
	};
}

/**
 * Wrap a store so one write is refused as a failed precondition, which is
 * how a store answers a hold that moved on since it was taken.
 *
 * @param store - The store the other requests are served from.
 * @param nth - Which write to refuse, counting from 1.
 * @returns The transport to hand the lock port.
 */
function refusingPut(store: FakeS3, nth: number): StateBackendFetch {
	let puts = 0;
	return async (input, init) => {
		if (init?.method === "PUT") {
			puts += 1;
			if (puts === nth) {
				return new Response(
					errorBody("PreconditionFailed", "the pre-condition did not hold"),
					{ status: 412 },
				);
			}
		}

		return store.fetchFunc(input, init);
	};
}

/**
 * A store that answers every write without an entity tag, which leaves a
 * release nothing to write against.
 *
 * @returns The transport to hand the lock port.
 */
function untaggedStore(): StateBackendFetch {
	return async () => new Response("", { status: 200 });
}

describe(createS3StateLockPort, () => {
	describe("acquire", () => {
		it("should take the hold with a conditional create against its own prefix segment", async () => {
			expect.assertions(3);

			const store = fakeS3();

			const hold = await lockFor({ fetch: store.fetchFunc }).acquire("production");

			assert(hold.success);

			expect(store.calls[0]!.method).toBe("PUT");
			expect(store.objects.has(LOCK_PATH)).toBeTrue();
			expect(store.calls).toHaveLength(1);
		});

		it("should send the wildcard condition unquoted", async () => {
			expect.assertions(1);

			const store = fakeS3();

			await lockFor({ fetch: store.fetchFunc }).acquire("production");

			expect(store.calls[0]!.headers["if-none-match"]).toBe("*");
		});

		it("should record who holds the environment, what for, and since when", async () => {
			expect.assertions(1);

			const store = fakeS3();
			const clock = createFakeClock(TEN_O_CLOCK);

			await lockFor({ fetch: store.fetchFunc, now: clock.now }).acquire("production", {
				operation: "deploy",
			});

			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)).toStrictEqual({
				id: THIS_RUN,
				operation: "deploy",
				owner: OWNER,
				since: "2026-08-27T10:00:00.000Z",
			});
		});

		it("should keep the lock under the configured prefix", async () => {
			expect.assertions(1);

			const store = fakeS3();

			await lockFor({ fetch: store.fetchFunc, prefix: "bedrock/state" }).acquire(
				"production",
			);

			expect([...store.objects.keys()]).toStrictEqual([
				"/bedrock/state/locks/production.json",
			]);
		});

		it("should take the hold when the run holding it releases part way through the wait", async () => {
			expect.assertions(2);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const clock = createFakeClock();

			const hold = await lockFor({
				fetch: releasingAfter(store, 2),
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(hold.success);

			expect(clock.waits).toStrictEqual([1000]);
			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)!.id).toBe(THIS_RUN);
		});

		it("should keep waiting when another run takes the tombstone over first", async () => {
			expect.assertions(2);

			const store = fakeS3({
				[LOCK_PATH]: serializeLockRecord({
					...OTHER_HOLD,
					releasedAt: "2026-08-27T09:30:00.000Z",
				}),
			});
			const clock = createFakeClock();

			const hold = await lockFor({
				fetch: refusingPut(store, 2),
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(hold.success);

			expect(clock.waits).toStrictEqual([1000]);
			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)?.id).toBe(THIS_RUN);
		});

		it("should report the wait and who it is waiting on while it waits", async () => {
			expect.assertions(1);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const clock = createFakeClock();
			const waits: Array<StateLockWaiting> = [];

			await lockFor({
				fetch: store.fetchFunc,
				lockTimeoutMs: 3000,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production", {
				onWaiting: (waiting) => {
					waits.push(waiting);
				},
			});

			expect(waits).toStrictEqual([
				{ elapsedMs: 0, holder: "ci-run-3", remainingMs: 3000 },
				{ elapsedMs: 1000, holder: "ci-run-3", remainingMs: 2000 },
			]);
		});

		it("should keep retrying when the holder's record cannot be read", async () => {
			expect.assertions(2);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const clock = createFakeClock();
			const waits: Array<StateLockWaiting> = [];

			const result = await lockFor({
				fetch: unreadableHolder(store),
				lockTimeoutMs: 1000,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production", {
				onWaiting: (waiting) => {
					waits.push(waiting);
				},
			});

			assert(!result.success);

			expect(waits).toStrictEqual([{ elapsedMs: 0, holder: undefined, remainingMs: 1000 }]);
			expect(result.err.detail).toStrictEqual({
				elapsedMs: 1000,
				file: LOCK_LABEL,
				holder: undefined,
				kind: "acquireTimedOut",
			});
		});

		it("should take the hold its own earlier attempt already landed rather than block on itself", async () => {
			expect.assertions(2);

			const store = fakeS3({
				[LOCK_PATH]: serializeLockRecord({
					id: THIS_RUN,
					operation: "deploy",
					owner: OWNER,
					since: "2026-08-27T10:00:00.000Z",
				}),
			});

			const hold = await lockFor({ fetch: store.fetchFunc, lockTimeoutMs: 0 }).acquire(
				"production",
			);

			assert(hold.success);

			expect(store.calls.map((call) => call.method)).toStrictEqual(["PUT", "GET"]);
			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)!.id).toBe(THIS_RUN);
		});

		it("should give up after the configured wait, naming who holds it and since when", async () => {
			expect.assertions(3);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const clock = createFakeClock();

			const result = await lockFor({
				fetch: store.fetchFunc,
				lockTimeoutMs: 5000,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(!result.success);

			expect(result.err.reason).toBe(
				`${LOCK_LABEL} is held by ci-run-3 for deploy since 2026-08-27T09:00:00.000Z; gave up after 5.0s`,
			);
			expect(result.err.detail).toStrictEqual({
				elapsedMs: 5000,
				file: LOCK_LABEL,
				holder: {
					operation: "deploy",
					owner: "ci-run-3",
					since: "2026-08-27T09:00:00.000Z",
				},
				kind: "acquireTimedOut",
			});
			expect(clock.waits).toStrictEqual([1000, 2000, 2000]);
		});

		it("should wait five minutes when the config names no bound of its own", async () => {
			expect.assertions(1);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const clock = createFakeClock();

			const result = await lockFor({
				fetch: store.fetchFunc,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(!result.success);

			expect(clock.waits.reduce((total, wait) => total + wait, 0)).toBe(
				DEFAULT_LOCK_TIMEOUT_MS,
			);
		});

		it("should say who holds it even once its record stops being readable", async () => {
			expect.assertions(1);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const clock = createFakeClock();

			const result = await lockFor({
				fetch: readableOnce(store),
				lockTimeoutMs: 3000,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(!result.success);

			expect(result.err.reason).toContain("is held by ci-run-3");
		});

		it("should wait on a real timer when the caller injects none", async () => {
			expect.assertions(1);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			let ticks = 0;

			const result = await lockFor({
				fetch: store.fetchFunc,
				lockTimeoutMs: 25,
				now: () => {
					ticks += 1;
					return ticks * 10;
				},
			}).acquire("production");

			assert(!result.success);

			expect(result.err.detail).toMatchObject({ elapsedMs: 30, kind: "acquireTimedOut" });
		});

		it("should give each acquisition an identity of its own when the caller mints none", async () => {
			expect.assertions(1);

			const first = fakeS3();
			const second = fakeS3();

			await createS3StateLockPort({
				bucket: BUCKET,
				credentials: CREDENTIALS,
				fetch: first.fetchFunc,
				owner: OWNER,
				region: REGION,
			}).acquire("production");
			await createS3StateLockPort({
				bucket: BUCKET,
				credentials: CREDENTIALS,
				fetch: second.fetchFunc,
				owner: OWNER,
				region: REGION,
			}).acquire("production");

			expect(parseLockRecord(first.objects.get(LOCK_PATH)!)?.id).not.toBe(
				parseLockRecord(second.objects.get(LOCK_PATH)!)?.id,
			);
		});

		it("should refuse an environment name that could escape the object layout", async () => {
			expect.assertions(2);

			const store = fakeS3();

			const result = await lockFor({ fetch: store.fetchFunc }).acquire("../etc");

			assert(!result.success);

			expect(result.err.detail).toStrictEqual({ file: "../etc", kind: "invalidEnvironment" });
			expect(store.calls).toBeEmpty();
		});

		it("should report a refusal that is not the store handing the hold to someone else", async () => {
			expect.assertions(2);

			const store = fakeS3Failure("AccessDenied", 403);

			const result = await lockFor({ fetch: store.fetchFunc }).acquire("production");

			assert(!result.success);

			expect(result.err.detail).toStrictEqual({
				name: "AccessDenied",
				file: LOCK_LABEL,
				kind: "acquireFailed",
				statusCode: 403,
			});
			expect(result.err.reason).toBe("refused with AccessDenied");
		});
	});

	describe("release", () => {
		it("should give the hold up by writing a tombstone over its own record", async () => {
			expect.assertions(3);

			const store = fakeS3();
			const clock = createFakeClock(TEN_O_CLOCK);

			const hold = await lockFor({ fetch: store.fetchFunc, now: clock.now }).acquire(
				"production",
			);
			assert(hold.success);

			await clock.sleepAsync(60_000);
			const given = await hold.data.release();

			assert(given.success);

			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)).toStrictEqual({
				id: THIS_RUN,
				operation: "deploy",
				owner: OWNER,
				releasedAt: "2026-08-27T10:01:00.000Z",
				since: "2026-08-27T10:00:00.000Z",
			});
			expect(store.calls.map((call) => call.method)).toStrictEqual(["PUT", "PUT"]);
			expect(store.calls[1]!.headers["if-match"]).toBe('"written-1"');
		});

		it("should report a hold the store no longer recognizes as the caller's", async () => {
			expect.assertions(2);

			const store = fakeS3();

			const hold = await lockFor({ fetch: refusingPut(store, 2) }).acquire("production");
			assert(hold.success);

			const given = await hold.data.release();

			assert(!given.success);

			expect(given.err.detail).toStrictEqual({
				name: "PreconditionFailed",
				file: LOCK_LABEL,
				kind: "releaseFailed",
				statusCode: 412,
			});
			expect(given.err.reason).toBe("the pre-condition did not hold");
		});

		it("should refuse to give up a hold the store gave no entity tag for", async () => {
			expect.assertions(2);

			const hold = await lockFor({ fetch: untaggedStore() }).acquire("production");
			assert(hold.success);

			const given = await hold.data.release();

			assert(!given.success);

			expect(given.err.detail).toStrictEqual({ file: LOCK_LABEL, kind: "releaseFailed" });
			expect(given.err.reason).toContain("cannot be given up");
		});
	});
});
