import type { StateBackendFetch } from "@bedrock-rbx/core";

import { assert, describe, expect, it } from "vitest";

import {
	type CapturedS3Request,
	errorBody,
	fakeS3,
	fakeS3TakingEveryWrite,
} from "#tests/helpers/fake-s3";
import { probeConditionalWritesAsync } from "./conditional-write-probe.ts";
import { createConfiguredS3Client } from "./s3-client.ts";

const BUCKET = "my-bucket";
const KEY = "locks/.probe-this-run.json";
const PATH = "/locks/.probe-this-run.json";
const REGION = "eu-west-2";

const CREDENTIALS = { accessKeyId: "example-access-key", secretAccessKey: "example-secret" };

/**
 * Probe a store, with the credentials a test signs with supplied so
 * signing is exercised without reaching for the ambient AWS environment.
 *
 * @param fetchFunc - Transport the probe's requests are served from.
 * @returns What the store proved about its conditional creates.
 */
async function probeAsync(fetchFunc: StateBackendFetch) {
	return probeConditionalWritesAsync({
		key: KEY,
		bucket: BUCKET,
		client: createConfiguredS3Client({
			bucket: BUCKET,
			credentials: CREDENTIALS,
			fetch: fetchFunc,
			region: REGION,
		}),
	});
}

/**
 * A store that takes every write but refuses one of them with an error of
 * its own, which says nothing about how it evaluates conditions.
 *
 * @param nth - Which write to refuse, counting from 1.
 * @returns The transport and the calls it recorded.
 */
function refusingWrite(nth: number): {
	calls: Array<CapturedS3Request>;
	fetchFunc: StateBackendFetch;
} {
	const store = fakeS3TakingEveryWrite();
	let writes = 0;
	return {
		calls: store.calls,
		fetchFunc: async (input, init) => {
			const answered = await store.fetchFunc(input, init);
			if (init?.method !== "PUT") {
				return answered;
			}

			writes += 1;
			return writes === nth
				? new Response(
						errorBody("AccessDenied", "the credential may not write this object"),
						{ status: 403 },
					)
				: answered;
		},
	};
}

/**
 * A store that takes the writes and refuses to give the scratch object up.
 *
 * @param store - The store the writes are served from.
 * @returns The transport to hand the probe.
 */
function undeletable(store: { fetchFunc: StateBackendFetch }): StateBackendFetch {
	return async (input, init) => {
		return init?.method === "DELETE"
			? new Response(errorBody("AccessDenied", "the credential may not delete this object"), {
					status: 403,
				})
			: store.fetchFunc(input, init);
	};
}

/**
 * Read what the store was asked for, in order.
 *
 * @param calls - Requests the store recorded.
 * @returns The methods, in the order they arrived.
 */
function methodsOf(calls: ReadonlyArray<CapturedS3Request>): Array<string> {
	return calls.map((call) => call.method);
}

describe(probeConditionalWritesAsync, () => {
	it("should pass a store that refuses a create of an object it already holds", async () => {
		expect.assertions(2);

		const store = fakeS3();

		const probed = await probeAsync(store.fetchFunc);

		expect(probed).toStrictEqual({ kind: "honoured" });
		expect(methodsOf(store.calls)).toStrictEqual(["PUT", "PUT", "DELETE"]);
	});

	it("should require the object to be absent with a bare wildcard", async () => {
		expect.assertions(2);

		const store = fakeS3();

		await probeAsync(store.fetchFunc);

		expect(store.calls[0]!.headers["if-none-match"]).toBeUndefined();
		expect(store.calls[1]!.headers["if-none-match"]).toBe("*");
	});

	it("should take the scratch object away once the store has answered", async () => {
		expect.assertions(1);

		const store = fakeS3();

		await probeAsync(store.fetchFunc);

		expect(store.objects.has(PATH)).toBeFalse();
	});

	it("should fail a store that takes a create of an object it already holds", async () => {
		expect.assertions(2);

		const store = fakeS3TakingEveryWrite();

		const probed = await probeAsync(store.fetchFunc);

		expect(probed).toStrictEqual({ kind: "ignored" });
		expect(methodsOf(store.calls)).toStrictEqual(["PUT", "PUT", "DELETE"]);
	});

	it("should prove nothing when the store refuses the write it is probed with", async () => {
		expect.assertions(3);

		const store = refusingWrite(1);

		const probed = await probeAsync(store.fetchFunc);
		assert(probed.kind === "unproven");

		expect(probed.failure.name).toBe("AccessDenied");
		expect(probed.failure.statusCode).toBe(403);
		expect(methodsOf(store.calls)).toStrictEqual(["PUT", "DELETE"]);
	});

	it("should prove nothing when the conditional write is refused for another reason", async () => {
		expect.assertions(2);

		const store = refusingWrite(2);

		const probed = await probeAsync(store.fetchFunc);
		assert(probed.kind === "unproven");

		expect(probed.failure.name).toBe("AccessDenied");
		expect(methodsOf(store.calls)).toStrictEqual(["PUT", "PUT", "DELETE"]);
	});

	it("should still answer when the scratch object cannot be taken away", async () => {
		expect.assertions(1);

		const probed = await probeAsync(undeletable(fakeS3()));

		expect(probed).toStrictEqual({ kind: "honoured" });
	});
});
