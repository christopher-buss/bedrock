import type { StateBackendFetch, StateLockError, StateLockWaiting } from "@bedrock-rbx/core";

import { assert, describe, expect, it, vi } from "vitest";

import { createFakeClock, createFakeSchedule, type FakeClock } from "#tests/helpers/fake-clock";
import { errorBody, type FakeS3, fakeS3, fakeS3Failure } from "#tests/helpers/fake-s3";
import { isoAt, parseLockRecord, type S3LockRecord, serializeLockRecord } from "./lock-record.ts";
import {
	createS3StateLockPort,
	DEFAULT_LOCK_TIMEOUT_MS,
	delayAsync,
	intervalEvery,
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
	expiresAt: "2026-08-27T10:05:00.000Z",
	operation: "deploy",
	owner: "ci-run-3",
	since: "2026-08-27T09:00:00.000Z",
};

const TEN_O_CLOCK = Date.parse("2026-08-27T10:00:00.000Z");

// How long a hold is leased for where a test states the lease itself.
const LEASE_MS = 60_000;

/** A store a test can make briefly unwell, and well again. */
interface UnwellStore {
	/** The transport to hand the lock port. */
	readonly fetchFunc: StateBackendFetch;
	/** Serve writes again. */
	readonly recover: () => void;
	/** Refuse every write from here on, for a reason a retry may not meet. */
	readonly sicken: () => void;
}

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
 * Wrap a store so the holder keeps its **Lease** alive, restamping the
 * deadline on the record every time the record is read.
 *
 * @param store - The store the requests are served from.
 * @param clock - The clock the deadline is restamped against.
 * @returns The transport to hand the lock port.
 */
function renewingHolder(store: FakeS3, clock: FakeClock): StateBackendFetch {
	return async (input, init) => {
		if (init?.method !== "PUT") {
			store.objects.set(
				LOCK_PATH,
				serializeLockRecord({
					...OTHER_HOLD,
					expiresAt: isoAt(clock.now() + 60_000),
				}),
			);
		}

		return store.fetchFunc(input, init);
	};
}

/**
 * Wrap a store so a test can refuse its writes for a stretch, which is a
 * store that is briefly unwell rather than a hold that has moved on.
 *
 * @param store - The store the requests are served from while it is well.
 * @returns The transport, plus what makes the store unwell and well.
 */
function unwellStore(store: FakeS3): UnwellStore {
	let unwell = false;
	return {
		fetchFunc: async (input, init) => {
			return unwell && init?.method === "PUT"
				? new Response(errorBody("InternalError", "We encountered an internal error."), {
						status: 500,
					})
				: store.fetchFunc(input, init);
		},
		recover: () => {
			unwell = false;
		},
		sicken: () => {
			unwell = true;
		},
	};
}

/**
 * Wrap a store so one write is answered without an entity tag, which
 * leaves the next write against it nothing to be conditional on.
 *
 * @param store - The store the other requests are served from.
 * @param nth - Which write to answer untagged, counting from 1.
 * @returns The transport to hand the lock port.
 */
function untaggedAfter(store: FakeS3, nth: number): StateBackendFetch {
	let puts = 0;
	return async (input, init) => {
		if (init?.method === "PUT") {
			puts += 1;
			if (puts === nth) {
				return new Response("", { status: 200 });
			}
		}

		return store.fetchFunc(input, init);
	};
}

/**
 * Wrap a store so it names no entity tag on anything from one request on,
 * which leaves both a renewal and the read after it nothing to name the
 * bytes the hold stands on.
 *
 * @param store - The store the requests are served from.
 * @param from - Which request to stop naming tags on, counting from 1.
 * @returns The transport to hand the lock port.
 */
function untaggedFrom(store: FakeS3, from: number): StateBackendFetch {
	let calls = 0;
	return async (input, init) => {
		calls += 1;
		const response = await store.fetchFunc(input, init);
		if (calls < from) {
			return response;
		}

		const headers = new Headers(response.headers);
		headers.delete("etag");
		return new Response(await response.text(), { headers, status: response.status });
	};
}

/**
 * Wrap a store so one write is answered without an entity tag and every
 * read after it finds another run's record, which is a renewal that landed
 * on an object another run has since taken over.
 *
 * @param store - The store the earlier requests are served from.
 * @param nth - Which write to answer untagged, counting from 1.
 * @returns The transport to hand the lock port.
 */
function overwrittenAfter(store: FakeS3, nth: number): StateBackendFetch {
	let puts = 0;
	let taken = false;
	return async (input, init) => {
		if (init?.method === "PUT") {
			puts += 1;
			if (puts === nth) {
				taken = true;
				return new Response("", { status: 200 });
			}
		}

		return taken
			? new Response(serializeLockRecord(OTHER_HOLD), {
					headers: { etag: '"theirs"' },
					status: 200,
				})
			: store.fetchFunc(input, init);
	};
}

/**
 * Wrap a store so it answers only once the whole lease has passed, which
 * is a hold stamped with a deadline the store spends longer than.
 *
 * @param store - The store the requests are served from.
 * @param clock - The clock the wait moves, by the whole of the lease.
 * @returns The transport to hand the lock port.
 */
function slowerThanTheLease(store: FakeS3, clock: FakeClock): StateBackendFetch {
	return async (input, init) => {
		const response = await store.fetchFunc(input, init);
		await clock.sleepAsync(LEASE_MS);
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

// Methods the untagged-write transports were asked for, in order.
const untaggedMethods: Array<string> = [];

/**
 * A store that answers every write without an entity tag, and every read
 * with the bytes the last write stored.
 *
 * @param etag - Entity tag a read names, absent when the store names none
 * there either.
 * @returns The transport to hand the lock port.
 */
function untaggedWrites(etag?: string): StateBackendFetch {
	untaggedMethods.length = 0;
	let stored = "";

	return async (input, init) => {
		untaggedMethods.push(init?.method ?? "GET");
		if (init?.method === "PUT") {
			const write = new Request(input, init);
			stored = await write.text();
			return new Response("", { status: 200 });
		}

		return new Response(stored, {
			...(etag === undefined ? {} : { headers: { etag } }),
			status: 200,
		});
	};
}

/**
 * A store that answers a write without an entity tag and a read with
 * another run's hold, which is a create that landed on a record this
 * acquisition did not write.
 *
 * @returns The transport to hand the lock port.
 */
function untaggedOverAnother(): StateBackendFetch {
	untaggedMethods.length = 0;

	return async (_input, init) => {
		untaggedMethods.push(init?.method ?? "GET");
		return init?.method === "PUT"
			? new Response("", { status: 200 })
			: new Response(serializeLockRecord(OTHER_HOLD), {
					headers: { etag: '"theirs"' },
					status: 200,
				});
	};
}

/**
 * A store that refuses the create and answers the read with this run's own
 * record under no entity tag, which is a write that landed and can never
 * be given up.
 *
 * @returns The transport to hand the lock port.
 */
function untaggedOwnRecord(): StateBackendFetch {
	untaggedMethods.length = 0;
	const own = serializeLockRecord({
		id: THIS_RUN,
		expiresAt: "2026-08-27T10:01:00.000Z",
		operation: "deploy",
		owner: OWNER,
		since: "2026-08-27T10:00:00.000Z",
	});

	return async (_input, init) => {
		untaggedMethods.push(init?.method ?? "GET");
		return init?.method === "PUT"
			? new Response(errorBody("PreconditionFailed", "the pre-condition did not hold"), {
					status: 412,
				})
			: new Response(own, { status: 200 });
	};
}

/**
 * A store that names no entity tag anywhere and refuses the delete that
 * would discard the record left on the object.
 *
 * @returns The transport to hand the lock port.
 */
function undeletable(): StateBackendFetch {
	return async (_input, init) => {
		return init?.method === "DELETE"
			? new Response(errorBody("AccessDenied", "the credential may not delete this object"), {
					status: 403,
				})
			: new Response("", { status: 200 });
	};
}

/**
 * Wrap a store so the run holding it releases part way through the wait
 * and another run takes the tombstone over first, which is how the holder
 * this acquisition read stops being the one in the way.
 *
 * @param store - The store the reads are served from.
 * @param afterPuts - How many refused writes to let by before the holder
 * releases.
 * @returns The transport to hand the lock port.
 */
function outbidAfter(store: FakeS3, afterPuts: number): StateBackendFetch {
	let puts = 0;
	return async (input, init) => {
		if (init?.method !== "PUT") {
			return store.fetchFunc(input, init);
		}

		puts += 1;
		if (puts === afterPuts) {
			store.objects.set(
				LOCK_PATH,
				serializeLockRecord({ ...OTHER_HOLD, releasedAt: "2026-08-27T09:30:00.000Z" }),
			);
		}

		return new Response(errorBody("PreconditionFailed", "the pre-condition did not hold"), {
			status: 412,
		});
	};
}

// Methods {@link untaggedTombstone} was asked for, in order.
const methods: Array<string> = [];

/**
 * A store holding a tombstone it answers without an entity tag, which
 * leaves a takeover nothing to be conditional on.
 *
 * @returns The transport to hand the lock port.
 */
function untaggedTombstone(): StateBackendFetch {
	methods.length = 0;
	const tombstone = serializeLockRecord({
		...OTHER_HOLD,
		releasedAt: "2026-08-27T09:30:00.000Z",
	});

	return async (_input, init) => {
		methods.push(init?.method ?? "GET");
		return init?.method === "PUT"
			? new Response(errorBody("PreconditionFailed", "the pre-condition did not hold"), {
					status: 412,
				})
			: new Response(tombstone, { status: 200 });
	};
}

/**
 * Wrap a store so the holder's record is refused rather than unreachable,
 * which is a credential that will still be refused after any wait.
 *
 * @param store - The store the writes are served from.
 * @returns The transport to hand the lock port.
 */
function refusingReads(store: FakeS3): StateBackendFetch {
	return async (input, init) => {
		return init?.method === "PUT"
			? store.fetchFunc(input, init)
			: new Response(errorBody("AccessDenied", "the credential may not read this object"), {
					status: 403,
				});
	};
}

describe(createS3StateLockPort, () => {
	describe("acquire", () => {
		it("should take the hold with a conditional create against its own prefix segment", async () => {
			expect.assertions(4);

			const store = fakeS3();

			const hold = await lockFor({ fetch: store.fetchFunc }).acquire("production");

			assert(hold.success);

			expect(store.calls[0]!.method).toBe("PUT");
			expect(store.calls[0]!.headers["content-type"]).toBe("application/json");
			expect(store.objects.has(LOCK_PATH)).toBeTrue();
			expect(store.calls).toHaveLength(1);
		});

		it("should send the wildcard condition unquoted", async () => {
			expect.assertions(1);

			const store = fakeS3();

			await lockFor({ fetch: store.fetchFunc }).acquire("production");

			expect(store.calls[0]!.headers["if-none-match"]).toBe("*");
		});

		it("should record who holds the environment, what for, since when, and until when", async () => {
			expect.assertions(1);

			const store = fakeS3();
			const clock = createFakeClock(TEN_O_CLOCK);

			await lockFor({ fetch: store.fetchFunc, now: clock.now }).acquire("production", {
				operation: "deploy",
			});

			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)).toStrictEqual({
				id: THIS_RUN,
				expiresAt: "2026-08-27T10:01:00.000Z",
				operation: "deploy",
				owner: OWNER,
				since: "2026-08-27T10:00:00.000Z",
			});
		});

		it("should give the hold the lease the config asked for", async () => {
			expect.assertions(1);

			const store = fakeS3();
			const clock = createFakeClock(TEN_O_CLOCK);

			await lockFor({
				fetch: store.fetchFunc,
				lockLeaseMs: 90_000,
				now: clock.now,
			}).acquire("production");

			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)!.expiresAt).toBe(
				"2026-08-27T10:01:30.000Z",
			);
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
			expect.assertions(3);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const clock = createFakeClock();

			const hold = await lockFor({
				fetch: releasingAfter(store, 2),
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(hold.success);

			const takeover = store.calls.findLast((call) => call.method === "PUT");

			expect(clock.waits).toStrictEqual([1000]);
			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)!.id).toBe(THIS_RUN);
			// Written against the exact bytes the tombstone was read as, so a
			// run that got there first is not overwritten.
			expect(takeover!.headers["if-match"]).toBe('"seed-0"');
		});

		it("should take over a hold whose lease has run out", async () => {
			expect.assertions(3);

			const store = fakeS3({
				[LOCK_PATH]: serializeLockRecord({
					...OTHER_HOLD,
					expiresAt: "2026-08-27T09:59:59.999Z",
				}),
			});
			const clock = createFakeClock(TEN_O_CLOCK);

			const hold = await lockFor({
				fetch: store.fetchFunc,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(hold.success);

			expect(clock.waits).toBeEmpty();
			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)!.id).toBe(THIS_RUN);
			// Written against the exact bytes the expired hold was read as, so
			// a second waiter cannot take the same hold over.
			expect(store.calls.at(-1)!.headers["if-match"]).toBe('"seed-0"');
		});

		it("should take over a hold at the instant its lease runs out", async () => {
			expect.assertions(1);

			const store = fakeS3({
				[LOCK_PATH]: serializeLockRecord({
					...OTHER_HOLD,
					expiresAt: "2026-08-27T10:00:00.000Z",
				}),
			});
			const clock = createFakeClock(TEN_O_CLOCK);

			const hold = await lockFor({
				fetch: store.fetchFunc,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(hold.success);

			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)!.id).toBe(THIS_RUN);
		});

		it("should never take over a hold whose deadline is not an instant", async () => {
			expect.assertions(2);

			const store = fakeS3({
				[LOCK_PATH]: serializeLockRecord({ ...OTHER_HOLD, expiresAt: "whenever" }),
			});
			const clock = createFakeClock(TEN_O_CLOCK);

			const result = await lockFor({
				fetch: store.fetchFunc,
				lockTimeoutMs: 1000,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(!result.success);

			expect(result.err.detail).toMatchObject({ kind: "acquireTimedOut" });
			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)!.id).toBe("other-run");
		});

		it("should never take over a hold whose lease is still being renewed", async () => {
			expect.assertions(2);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const clock = createFakeClock(TEN_O_CLOCK);

			const result = await lockFor({
				fetch: renewingHolder(store, clock),
				lockTimeoutMs: 300_000,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(!result.success);

			expect(result.err.detail).toMatchObject({ kind: "acquireTimedOut" });
			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)!.id).toBe("other-run");
		});

		it("should keep waiting when another waiter takes the expired hold over first", async () => {
			expect.assertions(2);

			const store = fakeS3({
				[LOCK_PATH]: serializeLockRecord({
					...OTHER_HOLD,
					expiresAt: "2026-08-27T09:59:59.999Z",
				}),
			});
			const clock = createFakeClock(TEN_O_CLOCK);

			const hold = await lockFor({
				fetch: refusingPut(store, 2),
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
			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)!.id).toBe(THIS_RUN);
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
					expiresAt: "2026-08-27T10:01:00.000Z",
					operation: "deploy",
					owner: OWNER,
					since: "2026-08-27T10:00:00.000Z",
				}),
			});

			const clock = createFakeClock(TEN_O_CLOCK);

			const hold = await lockFor({
				fetch: store.fetchFunc,
				lockTimeoutMs: 0,
				now: clock.now,
			}).acquire("production");

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
				`${LOCK_LABEL} is held by ci-run-3 for deploy since 2026-08-27T09:00:00.000Z, leased until 2026-08-27T10:05:00.000Z; gave up after 5.0s`,
			);
			expect(result.err.detail).toStrictEqual({
				elapsedMs: 5000,
				file: LOCK_LABEL,
				holder: {
					expiresAt: "2026-08-27T10:05:00.000Z",
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
			expect.assertions(2);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const startedAt = Date.now();
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

			expect(result.err.detail).toMatchObject({ kind: "acquireTimedOut" });
			expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1);
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

			expect(parseLockRecord(first.objects.get(LOCK_PATH)!)!.id).not.toBe(
				parseLockRecord(second.objects.get(LOCK_PATH)!)!.id,
			);
		});

		it("should take no hold the store answered a whole lease later", async () => {
			expect.assertions(2);

			const store = fakeS3();
			const clock = createFakeClock(TEN_O_CLOCK);

			const result = await lockFor({
				fetch: slowerThanTheLease(store, clock),
				lockLeaseMs: LEASE_MS,
				lockTimeoutMs: 0,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(!result.success);

			expect(result.err.detail).toStrictEqual({ file: LOCK_LABEL, kind: "acquireFailed" });
			expect(result.err.reason).toContain("already run out by the time the store answered");
		});

		it("should take no hold the store gave no entity tag to give it up with", async () => {
			expect.assertions(2);

			const result = await lockFor({ fetch: untaggedStore() }).acquire("production");

			assert(!result.success);

			expect(result.err.detail).toStrictEqual({ file: LOCK_LABEL, kind: "acquireFailed" });
			expect(result.err.reason).toContain("could never be given up safely");
		});

		it("should record the hold as taken when it landed, not when the waiting began", async () => {
			expect.assertions(1);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const clock = createFakeClock(TEN_O_CLOCK);

			const hold = await lockFor({
				fetch: releasingAfter(store, 2),
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(hold.success);

			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)!.since).toBe(
				"2026-08-27T10:00:01.000Z",
			);
		});

		it("should take the hold on the entity tag a read names when the write named none", async () => {
			expect.assertions(2);

			const hold = await lockFor({ fetch: untaggedWrites('"recovered"') }).acquire(
				"production",
			);

			assert(hold.success);

			const given = await hold.data.release();

			expect(given.success).toBeTrue();
			expect(untaggedMethods).toStrictEqual(["PUT", "GET", "PUT"]);
		});

		it("should remove a record no entity tag can release rather than strand the environment", async () => {
			expect.assertions(2);

			const result = await lockFor({ fetch: untaggedWrites() }).acquire("production");

			assert(!result.success);

			expect(untaggedMethods).toStrictEqual(["PUT", "GET", "DELETE"]);
			expect(result.err.detail).toStrictEqual({ file: LOCK_LABEL, kind: "acquireFailed" });
		});

		it("should leave a record another run wrote where it is", async () => {
			expect.assertions(2);

			const result = await lockFor({ fetch: untaggedOverAnother() }).acquire("production");

			assert(!result.success);

			expect(untaggedMethods).toStrictEqual(["PUT", "GET"]);
			expect(result.err.detail).toStrictEqual({ file: LOCK_LABEL, kind: "acquireFailed" });
		});

		it("should report the missing entity tag even when the record cannot be removed", async () => {
			expect.assertions(1);

			const result = await lockFor({ fetch: undeletable() }).acquire("production");

			assert(!result.success);

			expect(result.err.detail).toStrictEqual({ file: LOCK_LABEL, kind: "acquireFailed" });
		});

		it("should remove a landed record of its own the store named no entity tag for", async () => {
			expect.assertions(2);

			const result = await lockFor({ fetch: untaggedOwnRecord() }).acquire("production");

			assert(!result.success);

			expect(untaggedMethods).toStrictEqual(["PUT", "GET", "DELETE"]);
			expect(result.err.reason).toContain("could never be given up safely");
		});

		it("should stop naming a holder once a later round finds it gone", async () => {
			expect.assertions(2);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const clock = createFakeClock();

			const result = await lockFor({
				fetch: outbidAfter(store, 2),
				lockTimeoutMs: 3000,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(!result.success);

			expect(result.err.detail).toMatchObject({ holder: undefined, kind: "acquireTimedOut" });
			expect(result.err.reason).toContain("is held by another run");
		});

		it("should give up at once when the holder's record is refused rather than unreachable", async () => {
			expect.assertions(3);

			const store = fakeS3({ [LOCK_PATH]: serializeLockRecord(OTHER_HOLD) });
			const clock = createFakeClock();

			const result = await lockFor({
				fetch: refusingReads(store),
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(!result.success);

			expect(result.err.detail).toStrictEqual({
				name: "AccessDenied",
				file: LOCK_LABEL,
				kind: "acquireFailed",
				statusCode: 403,
			});
			expect(clock.waits).toBeEmpty();
			expect(result.err.reason).toBe("the credential may not read this object");
		});

		it("should leave a tombstone alone when the store named no entity tag to take it over against", async () => {
			expect.assertions(2);

			const clock = createFakeClock();

			const result = await lockFor({
				fetch: untaggedTombstone(),
				lockTimeoutMs: 1000,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(!result.success);

			// Two rounds of create-then-read, and no takeover write between
			// them: there was nothing to make one conditional on.
			expect(methods).toStrictEqual(["PUT", "GET", "PUT", "GET"]);
			expect(result.err.detail).toMatchObject({ holder: undefined, kind: "acquireTimedOut" });
		});

		it("should keep waiting when the object holds bytes that are not a record", async () => {
			expect.assertions(2);

			const store = fakeS3({ [LOCK_PATH]: "{ not a lock record" });
			const clock = createFakeClock();
			const waits: Array<StateLockWaiting> = [];

			const result = await lockFor({
				fetch: store.fetchFunc,
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
			expect(result.err.detail).toMatchObject({ holder: undefined, kind: "acquireTimedOut" });
		});

		it("should refuse an environment name that could escape the object layout", async () => {
			expect.assertions(2);

			const store = fakeS3();

			const result = await lockFor({ fetch: store.fetchFunc }).acquire("../etc");

			assert(!result.success);

			expect(result.err.detail).toStrictEqual({ file: "../etc", kind: "invalidEnvironment" });
			expect(store.calls).toBeEmpty();
		});

		it("should report a write refused for a reason a read would have waited out", async () => {
			expect.assertions(2);

			const store = fakeS3Failure("InternalError", 500);
			const clock = createFakeClock();

			const result = await lockFor({
				fetch: store.fetchFunc,
				lockTimeoutMs: 1000,
				now: clock.now,
				sleep: clock.sleepAsync,
			}).acquire("production");

			assert(!result.success);

			expect(result.err.detail).toStrictEqual({
				name: "InternalError",
				file: LOCK_LABEL,
				kind: "acquireFailed",
				statusCode: 500,
			});
			expect(clock.waits).toBeEmpty();
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

	describe("renewal", () => {
		it("should renew the lease well before it runs out while the hold is held", async () => {
			expect.assertions(3);

			const store = fakeS3();
			const clock = createFakeClock(TEN_O_CLOCK);
			const schedule = createFakeSchedule();

			const hold = await lockFor({
				fetch: store.fetchFunc,
				lockLeaseMs: 60_000,
				now: clock.now,
				scheduleEvery: schedule.scheduleEvery,
			}).acquire("production");
			assert(hold.success);

			await clock.sleepAsync(20_000);
			await schedule.tickAsync();

			expect(schedule.every).toStrictEqual([20_000]);
			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)).toStrictEqual({
				id: THIS_RUN,
				expiresAt: "2026-08-27T10:01:20.000Z",
				operation: "deploy",
				owner: OWNER,
				since: "2026-08-27T10:00:00.000Z",
			});
			// Written against the bytes the hold was taken as, so a renewal
			// cannot overwrite a run that took the hold over.
			expect(store.calls[1]!.headers["if-match"]).toBe('"written-1"');
		});

		it("should give the hold up on the entity tag its last renewal answered with", async () => {
			expect.assertions(2);

			const store = fakeS3();
			const clock = createFakeClock(TEN_O_CLOCK);
			const schedule = createFakeSchedule();

			const hold = await lockFor({
				fetch: store.fetchFunc,
				now: clock.now,
				scheduleEvery: schedule.scheduleEvery,
			}).acquire("production");
			assert(hold.success);

			await schedule.tickAsync();
			const given = await hold.data.release();

			expect(given.success).toBeTrue();
			expect(store.calls.at(-1)!.headers["if-match"]).toBe('"written-2"');
		});

		it("should stop renewing once the hold is given up", async () => {
			expect.assertions(2);

			const store = fakeS3();
			const schedule = createFakeSchedule();

			const hold = await lockFor({
				fetch: store.fetchFunc,
				scheduleEvery: schedule.scheduleEvery,
			}).acquire("production");
			assert(hold.success);

			await hold.data.release();
			await schedule.tickAsync();

			expect(schedule.cancelled()).toBe(1);
			expect(store.calls.map((call) => call.method)).toStrictEqual(["PUT", "PUT"]);
		});

		it("should keep renewing after a refusal the next renewal may not meet", async () => {
			expect.assertions(2);

			const store = fakeS3();
			const unwell = unwellStore(store);
			const clock = createFakeClock(TEN_O_CLOCK);
			const schedule = createFakeSchedule();
			const lost: Array<StateLockError> = [];

			const hold = await lockFor({
				fetch: unwell.fetchFunc,
				now: clock.now,
				scheduleEvery: schedule.scheduleEvery,
			}).acquire("production", {
				onLeaseLost: (error) => {
					lost.push(error);
				},
			});
			assert(hold.success);

			unwell.sicken();
			await clock.sleepAsync(20_000);
			await schedule.tickAsync();
			unwell.recover();
			await clock.sleepAsync(20_000);
			await schedule.tickAsync();

			expect(lost).toBeEmpty();
			expect(parseLockRecord(store.objects.get(LOCK_PATH)!)!.expiresAt).toBe(
				"2026-08-27T10:01:40.000Z",
			);
		});

		it("should report a lease it could not keep until the deadline it was leased to", async () => {
			expect.assertions(3);

			const unwell = unwellStore(fakeS3());
			const clock = createFakeClock(TEN_O_CLOCK);
			const schedule = createFakeSchedule();
			const lost: Array<StateLockError> = [];

			const hold = await lockFor({
				fetch: unwell.fetchFunc,
				now: clock.now,
				scheduleEvery: schedule.scheduleEvery,
			}).acquire("production", {
				onLeaseLost: (error) => {
					lost.push(error);
				},
			});
			assert(hold.success);

			unwell.sicken();
			await clock.sleepAsync(20_000);
			await schedule.tickAsync();
			await clock.sleepAsync(40_000);
			await schedule.tickAsync();
			await schedule.tickAsync();

			expect(lost).toHaveLength(1);
			expect(lost[0]!.detail).toStrictEqual({
				name: "InternalError",
				file: LOCK_LABEL,
				kind: "leaseLost",
				statusCode: 500,
			});
			expect(schedule.cancelled()).toBe(1);
		});

		it("should report a lease another run has taken the hold over from", async () => {
			expect.assertions(2);

			const store = fakeS3();
			const schedule = createFakeSchedule();
			const lost: Array<StateLockError> = [];

			const hold = await lockFor({
				fetch: refusingPut(store, 2),
				scheduleEvery: schedule.scheduleEvery,
			}).acquire("production", {
				onLeaseLost: (error) => {
					lost.push(error);
				},
			});
			assert(hold.success);

			await schedule.tickAsync();

			expect(lost[0]!.detail).toStrictEqual({
				name: "PreconditionFailed",
				file: LOCK_LABEL,
				kind: "leaseLost",
				statusCode: 412,
			});
			expect(schedule.cancelled()).toBe(1);
		});

		it("should keep the hold on the entity tag a read names when a renewal named none", async () => {
			expect.assertions(3);

			const store = fakeS3();
			const schedule = createFakeSchedule();
			const lost: Array<StateLockError> = [];

			const hold = await lockFor({
				fetch: untaggedAfter(store, 2),
				scheduleEvery: schedule.scheduleEvery,
			}).acquire("production", {
				onLeaseLost: (error) => {
					lost.push(error);
				},
			});
			assert(hold.success);

			await schedule.tickAsync();
			const given = await hold.data.release();

			expect(lost).toBeEmpty();
			expect(schedule.cancelled()).toBe(1);
			expect(given.success).toBeTrue();
		});

		it("should report the lease lost when the read back finds another run's record", async () => {
			expect.assertions(2);

			const store = fakeS3();
			const schedule = createFakeSchedule();
			const lost: Array<StateLockError> = [];

			const hold = await lockFor({
				fetch: overwrittenAfter(store, 2),
				scheduleEvery: schedule.scheduleEvery,
			}).acquire("production", {
				onLeaseLost: (error) => {
					lost.push(error);
				},
			});
			assert(hold.success);

			await schedule.tickAsync();

			expect(lost[0]!.detail).toStrictEqual({ file: LOCK_LABEL, kind: "leaseLost" });
			expect(schedule.cancelled()).toBe(1);
		});

		it("should report the lease lost when no read can name what to write against", async () => {
			expect.assertions(3);

			const store = fakeS3();
			const schedule = createFakeSchedule();
			const lost: Array<StateLockError> = [];

			const hold = await lockFor({
				fetch: untaggedFrom(store, 2),
				scheduleEvery: schedule.scheduleEvery,
			}).acquire("production", {
				onLeaseLost: (error) => {
					lost.push(error);
				},
			});
			assert(hold.success);

			await schedule.tickAsync();

			expect(lost[0]!.detail).toStrictEqual({ file: LOCK_LABEL, kind: "leaseLost" });
			expect(lost[0]!.reason).toContain("can no longer be shown to be its own");
			expect(schedule.cancelled()).toBe(1);
		});

		it("should renew on a real timer when the caller injects no schedule", async () => {
			expect.assertions(1);

			const store = fakeS3();

			const hold = await lockFor({ fetch: store.fetchFunc, lockLeaseMs: 3 }).acquire(
				"production",
			);
			assert(hold.success);

			await vi.waitUntil(() => store.calls.length > 1);
			await hold.data.release();

			expect(store.calls[1]!.headers["if-match"]).toBe('"written-1"');
		});
	});

	describe("release", () => {
		it("should give the hold up by writing a tombstone over its own record", async () => {
			expect.assertions(4);

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
				expiresAt: "2026-08-27T10:01:00.000Z",
				operation: "deploy",
				owner: OWNER,
				releasedAt: "2026-08-27T10:01:00.000Z",
				since: "2026-08-27T10:00:00.000Z",
			});
			expect(store.calls.map((call) => call.method)).toStrictEqual(["PUT", "PUT"]);
			expect(store.calls[1]!.headers["if-match"]).toBe('"written-1"');
			expect(store.calls[1]!.headers["content-type"]).toBe("application/json");
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
	});
});

describe(delayAsync, () => {
	it("should not come back before the time it was asked to wait has passed", async () => {
		expect.assertions(1);

		const startedAt = Date.now();

		await delayAsync(25);

		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
	});
});

describe(intervalEvery, () => {
	it("should carry on running after a run of its own rejects", async () => {
		expect.assertions(1);

		let runs = 0;
		const cancel = intervalEvery(1, async () => {
			runs += 1;
			throw new Error("the renewal rejected");
		});

		await vi.waitUntil(() => runs > 1);
		cancel();

		expect(runs).toBeGreaterThan(1);
	});

	it("should run again and again until it is cancelled", async () => {
		expect.assertions(1);

		let runs = 0;
		const cancel = intervalEvery(1, async () => {
			runs += 1;
		});

		await vi.waitUntil(() => runs > 1);
		cancel();
		const cancelledAfter = runs;
		await delayAsync(25);

		expect(runs).toBe(cancelledAfter);
	});
});
