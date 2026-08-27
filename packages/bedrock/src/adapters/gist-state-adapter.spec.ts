import { fromAny } from "@total-typescript/shoehorn";

import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import {
	emptyResponse,
	fakeFetch,
	fakeFetchSequence,
	fakeGistFetch,
	fakeRandom,
	fakeSleep,
	okJson,
} from "#tests/helpers/fake-gist-fetch";
import { serializeStateFile } from "../core/state-file.ts";
import type { BedrockState } from "../core/state.ts";
import { createGistStateAdapter } from "./gist-state-adapter.ts";

const GIST_ID = "abc123def456";
const TOKEN = "ghp_example_token";

// The visibility poll now matches written content, so a "file is visible"
// GET fixture must echo exactly what `write` PATCHed for the same state.
const PRODUCTION_STATE: BedrockState = { environment: "production", resources: [], version: 1 };
const PRODUCTION_CONTENT = serializeStateFile(PRODUCTION_STATE);

/**
 * A 403 carrying the headers GitHub attaches when it throttles a request.
 *
 * @param headers - The rate-limit headers the response carries.
 * @returns The throttled response.
 */
function throttled(headers: Record<string, string>): Response {
	return new Response("", { headers, status: 403 });
}

/**
 * Gist metadata for a file GitHub truncated, pointing the reader at the raw
 * CDN copy.
 *
 * @param size - The untruncated byte size GitHub reports.
 * @returns The metadata response.
 */
function truncatedMeta(size: number): Response {
	return okJson({
		files: {
			"state.production.json": {
				content: "",
				raw_url: "https://gist.example/raw/abc",
				size,
				truncated: true,
			},
		},
	});
}

describe(createGistStateAdapter, () => {
	describe("read", () => {
		it("should send a GET to the gists endpoint", async () => {
			expect.assertions(3);

			const { calls, fetchFn } = fakeFetch(() => okJson({ files: {} }));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			await port.read("production");

			expect(calls).toHaveLength(1);
			expect(calls[0]!.url).toBe(`https://api.github.com/gists/${GIST_ID}`);
			expect(calls[0]!.method).toBe("GET");
		});

		it("should include the expected auth, api-version, and accept headers", async () => {
			expect.assertions(3);

			const { calls, fetchFn } = fakeFetch(() => okJson({ files: {} }));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			await port.read("production");

			const { headers } = calls[0]!;

			expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
			expect(headers.get("x-github-api-version")).toBe("2026-03-10");
			expect(headers.get("accept")).toBe("application/vnd.github+json");
		});

		it("should send a User-Agent header", async () => {
			expect.assertions(1);

			const { calls, fetchFn } = fakeFetch(() => okJson({ files: {} }));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			await port.read("production");

			expect(calls[0]!.headers.get("user-agent")).toBe("bedrock");
		});

		it("should report no state when the environment file is absent", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => okJson({ files: {} }));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();

			assert(result.success);

			expect(result.data.state).toBeUndefined();
		});

		it("should parse a present environment file into state", async () => {
			expect.assertions(2);

			const state: BedrockState = { environment: "production", resources: [], version: 1 };
			const content = serializeStateFile(state);
			const { fetchFn } = fakeFetch(() => {
				return okJson({
					files: {
						"state.production.json": {
							content,
							size: content.length,
							truncated: false,
						},
					},
				});
			});
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();

			assert(result.success);

			expect(result.data.state).toStrictEqual(state);
		});

		it("should carry no version, leaving the next write unconditional", async () => {
			expect.assertions(1);

			const state: BedrockState = { environment: "production", resources: [], version: 1 };
			const content = serializeStateFile(state);
			const { fetchFn } = fakeFetch(() => {
				return okJson({
					files: {
						"state.production.json": {
							content,
							size: content.length,
							truncated: false,
						},
					},
				});
			});
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			assert(result.success);

			expect(result.data.version).toBeUndefined();
		});

		it("should err with a gist-not-found reason when the gist 404s", async () => {
			expect.assertions(4);

			const { fetchFn } = fakeFetch(() => emptyResponse(404));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.kind).toBe("stateNotFound");
			expect(result.err.reason).toMatch(/gist .* not found/u);
			expect(result.err.file).toBe(`gist:${GIST_ID}/state.production.json`);
		});

		it.for<[number]>([[401], [403]])(
			"should err with an access-denied reason on %i",
			async ([status]) => {
				expect.assertions(3);

				const { fetchFn } = fakeFetch(() => emptyResponse(status));
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					token: TOKEN,
				});

				const result = await port.read("production");

				expect(result.success).toBeFalse();

				assert(!result.success);

				expect(result.err.kind).toBe("stateAccessDenied");
				expect(result.err.reason).toMatch(/auth failed/u);
			},
		);

		it("should err when a 200 response carries a JSON body that is not an object", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => new Response("[]", { status: 200 }));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toMatch(/not a JSON object/u);
			expect(result.err.kind).toBe("stateError");
		});

		it("should err with a rate-limited reason on 403 carrying a Retry-After header", async () => {
			expect.assertions(4);

			const { fetchFn } = fakeFetch(
				() => new Response("", { headers: { "Retry-After": "60" }, status: 403 }),
			);
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.read("production");

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.reason).toMatch(/rate limit/u);
			expect(result.err.reason).not.toMatch(/auth failed/u);
			expect(result.err.reason).toContain("60");
		});

		it("should err with a rate-limited reason on 403 carrying X-RateLimit-Remaining: 0", async () => {
			expect.assertions(4);

			const { fetchFn } = fakeFetch(
				() => new Response("", { headers: { "X-RateLimit-Remaining": "0" }, status: 403 }),
			);
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				random: fakeRandom(),
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.read("production");

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.reason).toMatch(/rate limit/u);
			expect(result.err.reason).not.toMatch(/auth failed/u);
			expect(result.err.reason).not.toMatch(/retry after/u);
		});

		it("should err with an auth reason on 401 even when rate-limit headers are present", async () => {
			expect.assertions(3);

			const { fetchFn } = fakeFetch(
				() => new Response("", { headers: { "Retry-After": "60" }, status: 401 }),
			);
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.reason).toMatch(/auth failed/u);
			expect(result.err.reason).not.toMatch(/rate limit/u);
		});

		it("should err with a network-error reason when fetch throws", async () => {
			expect.assertions(2);

			async function throwingFetchAsync(): Promise<Response> {
				throw new Error("connection reset");
			}

			const port = createGistStateAdapter({
				fetch: throwingFetchAsync,
				gistId: GIST_ID,
				token: TOKEN,
			});

			const result = await port.read("production");

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.reason).toMatch(/network error/u);
		});

		it("should err with a network-error reason when the raw_url fetch throws", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeGistFetch({
				get: truncatedMeta(2_000_000),
				raw: new Error("connection reset"),
			});
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				token: TOKEN,
			});

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toMatch(/network error/u);
			expect(result.err.file).toBe(`gist:${GIST_ID}/state.production.json`);
		});

		it("should err with a github-returned-<status> reason on 500", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => emptyResponse(500));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toMatch(/github returned 500/u);
			expect(result.err.reason).not.toMatch(/auth failed|not found/u);
		});

		it("should append github's error body to the fallback reason", async () => {
			expect.assertions(1);

			const { fetchFn } = fakeFetch(
				() => new Response('{"message":"Something odd"}', { status: 400 }),
			);
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toBe(
				'github returned 400 (body: {"message":"Something odd"})',
			);
		});

		it("should keep the bare status reason when the error body cannot be read", async () => {
			expect.assertions(1);

			// Consuming the body up front makes the adapter's own text() call
			// reject (body already disturbed), exercising the unreadable-body
			// path.
			const disturbed = new Response("x", { status: 400 });
			await disturbed.text();
			const { fetchFn } = fakeFetch(() => disturbed);
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toBe("github returned 400");
		});

		it("should keep the bare status reason when the error body is whitespace-only", async () => {
			expect.assertions(1);

			const { fetchFn } = fakeFetch(() => new Response(" ".repeat(3), { status: 400 }));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toBe("github returned 400");
		});

		it("should keep a github error body of exactly 500 characters untruncated", async () => {
			expect.assertions(1);

			const { fetchFn } = fakeFetch(() => new Response("x".repeat(500), { status: 400 }));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toBe(`github returned 400 (body: ${"x".repeat(500)})`);
		});

		it("should stringify a non-Error throw as the network-error reason", async () => {
			expect.assertions(1);

			async function throwingFetchAsync(): Promise<Response> {
				// eslint-disable-next-line ts/only-throw-error -- exercises the non-Error catch branch
				throw "socket refused";
			}

			const port = createGistStateAdapter({
				fetch: throwingFetchAsync,
				gistId: GIST_ID,
				token: TOKEN,
			});

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toBe("network error: socket refused");
		});

		it("should keep the bare network-error reason when no transport code is present", async () => {
			expect.assertions(1);

			async function throwingFetchAsync(): Promise<Response> {
				throw new Error("connection reset");
			}

			const port = createGistStateAdapter({
				fetch: throwingFetchAsync,
				gistId: GIST_ID,
				token: TOKEN,
			});

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toBe("network error: connection reset");
		});

		it("should truncate a github error body beyond 500 characters with an ellipsis", async () => {
			expect.assertions(1);

			const { fetchFn } = fakeFetch(() => new Response("x".repeat(501), { status: 400 }));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toBe(`github returned 400 (body: ${"x".repeat(500)}…)`);
		});

		it("should append github's error body to the auth-failed reason", async () => {
			expect.assertions(1);

			const { fetchFn } = fakeFetch(
				() => new Response('{"message":"Bad credentials"}', { status: 401 }),
			);
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toBe(
				'auth failed (401): check token scopes (body: {"message":"Bad credentials"})',
			);
		});

		it("should name the transport code from the fetch error's cause chain", async () => {
			expect.assertions(1);

			async function throwingFetchAsync(): Promise<Response> {
				throw new TypeError("fetch failed", {
					cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
				});
			}

			const port = createGistStateAdapter({
				fetch: throwingFetchAsync,
				gistId: GIST_ID,
				token: TOKEN,
			});

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toBe("network error: fetch failed (ECONNRESET)");
		});

		it("should report no state when the files dict is missing on the gist response", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => okJson({}));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();

			assert(result.success);

			expect(result.data.state).toBeUndefined();
		});

		it("should report no state when the file entry is null in the gist response", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(
				() => new Response('{"files":{"state.production.json":null}}', { status: 200 }),
			);
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();

			assert(result.success);

			expect(result.data.state).toBeUndefined();
		});

		it("should report no state when the file entry is a non-object primitive", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => {
				return okJson({ files: { "state.production.json": "not-an-object" } });
			});
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();

			assert(result.success);

			expect(result.data.state).toBeUndefined();
		});

		it("should err with a raw_url-fetch-returned reason when the cdn returns non-ok", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeGistFetch({
				get: truncatedMeta(2_000_000),
				raw: emptyResponse(503),
			});
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toMatch(/raw_url fetch returned 503/u);
			expect(result.err.reason).not.toBe("");
		});

		it("should err when the environment name contains unsafe characters", async () => {
			expect.assertions(2);

			const { calls, fetchFn } = fakeFetch(() => okJson({ files: {} }));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("prod/staging");

			expect(result.success).toBeFalse();
			expect(calls).toBeEmpty();
		});

		it("should err when the state file exceeds 10 MB", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => {
				return okJson({
					files: {
						"state.production.json": {
							content: "",
							raw_url: "https://gist.example/raw/abc",
							size: 10_000_001,
							truncated: true,
						},
					},
				});
			});
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.reason).toMatch(/too large/u);
		});

		it("should accept a state file at exactly the 10 MB threshold", async () => {
			expect.assertions(1);

			const state: BedrockState = { environment: "production", resources: [], version: 1 };
			const content = serializeStateFile(state);
			const { fetchFn } = fakeGistFetch({
				get: truncatedMeta(10_000_000),
				raw: new Response(content, { status: 200 }),
			});
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();
		});

		it("should err with a missing-raw_url reason when a truncated file has no raw_url", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => {
				return okJson({
					files: {
						"state.production.json": {
							content: "",
							size: 2_000_000,
							truncated: true,
						},
					},
				});
			});
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.reason).toMatch(/missing raw_url/u);
			expect(result.err.reason).not.toBe("");
		});

		it("should follow raw_url for a truncated file between 1 MB and 10 MB", async () => {
			expect.assertions(2);

			const state: BedrockState = { environment: "production", resources: [], version: 1 };
			const content = serializeStateFile(state);
			const { fetchFn } = fakeGistFetch({
				get: truncatedMeta(2_000_000),
				raw: new Response(content, { status: 200 }),
			});
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();

			assert(result.success);

			expect(result.data.state).toStrictEqual(state);
		});

		it.for<[number]>([[502], [503], [504]])(
			"should retry the read GET on %i and succeed on the second attempt",
			async ([status]) => {
				expect.assertions(3);

				const { calls, fetchFn } = fakeFetchSequence([
					emptyResponse(status),
					okJson({ files: {} }),
				]);
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					random: fakeRandom(),
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.read("production");

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(2);
				expect(sleepFake.calls).toStrictEqual([250]);
			},
		);

		it.for<[number]>([[502], [503], [504]])(
			"should retry the raw_url fetch on %i and succeed on the second attempt",
			async ([status]) => {
				expect.assertions(3);

				const state: BedrockState = {
					environment: "production",
					resources: [],
					version: 1,
				};
				const content = serializeStateFile(state);
				const { calls, fetchFn } = fakeFetchSequence([
					okJson({
						files: {
							"state.production.json": {
								content: "",
								raw_url: "https://gist.example/raw/abc",
								size: 2_000_000,
								truncated: true,
							},
						},
					}),
					emptyResponse(status),
					new Response(content, { status: 200 }),
				]);
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					random: fakeRandom(),
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.read("production");

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(3);
				expect(sleepFake.calls).toStrictEqual([250]);
			},
		);

		it("should retry a throttled read GET and succeed on the second attempt", async () => {
			expect.assertions(3);

			const { calls, fetchFn } = fakeFetchSequence([
				throttled({ "Retry-After": "2" }),
				okJson({ files: {} }),
			]);
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				random: fakeRandom(),
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.read("production");

			expect(result.success).toBeTrue();
			expect(calls).toHaveLength(2);
			expect(sleepFake.calls).toStrictEqual([2000]);
		});

		it("should retry a 403 that reports the rate-limit budget spent", async () => {
			expect.assertions(3);

			const { calls, fetchFn } = fakeFetchSequence([
				throttled({ "X-RateLimit-Remaining": "0" }),
				okJson({ files: {} }),
			]);
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				random: fakeRandom(),
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.read("production");

			expect(result.success).toBeTrue();
			expect(calls).toHaveLength(2);
			expect(sleepFake.calls).toStrictEqual([250]);
		});

		it("should bound a Retry-After that outlasts the maximum wait", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetchSequence([
				throttled({ "Retry-After": "3600" }),
				okJson({ files: {} }),
			]);
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				random: fakeRandom(),
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.read("production");

			expect(result.success).toBeTrue();
			expect(sleepFake.calls).toStrictEqual([30_000]);
		});

		it("should fall back to the backoff schedule when Retry-After is not a count of seconds", async () => {
			expect.assertions(2);

			// HTTP allows Retry-After to carry an absolute date; GitHub sends
			// seconds, so a date is a shape the adapter cannot wait on.
			const { fetchFn } = fakeFetchSequence([
				throttled({ "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }),
				okJson({ files: {} }),
			]);
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				random: fakeRandom(),
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.read("production");

			expect(result.success).toBeTrue();
			expect(sleepFake.calls).toStrictEqual([250]);
		});

		it("should refuse a 403 carrying no rate-limit headers without retrying", async () => {
			expect.assertions(3);

			const { calls, fetchFn } = fakeFetchSequence([emptyResponse(403)]);
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				random: fakeRandom(),
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.read("production");

			assert(!result.success);

			expect(result.err.kind).toBe("stateAccessDenied");
			expect(calls).toHaveLength(1);
			expect(sleepFake.calls).toStrictEqual([]);
		});
	});

	describe("write", () => {
		it("should PATCH the gist with the serialized state file on write", async () => {
			expect.assertions(3);

			const { calls, fetchFn } = fakeGistFetch({
				get: okJson({
					files: { "state.production.json": { content: PRODUCTION_CONTENT } },
				}),
				patch: emptyResponse(200),
			});
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.write({
				environment: "production",
				resources: [],
				version: 1,
			});

			expect(result.success).toBeTrue();

			const patchRequest = calls[0]!;

			expect(patchRequest.method).toBe("PATCH");

			const body: { files: Record<string, { content: string }> } = fromAny(
				await patchRequest.json(),
			);

			expect(JSON.parse(body.files["state.production.json"]!.content)).toStrictEqual({
				$bedrock: { version: 1 },
				environment: "production",
				resources: [],
			});
		});

		it("should send a json content-type header on write", async () => {
			expect.assertions(1);

			const { calls, fetchFn } = fakeGistFetch({
				get: okJson({
					files: { "state.production.json": { content: PRODUCTION_CONTENT } },
				}),
				patch: emptyResponse(200),
			});
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			await port.write({ environment: "production", resources: [], version: 1 });

			expect(calls[0]!.headers.get("content-type")).toBe("application/json");
		});

		it("should err when writing with an unsafe environment name", async () => {
			expect.assertions(2);

			const { calls, fetchFn } = fakeFetch(() => emptyResponse(200));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.write({
				environment: "../escape",
				resources: [],
				version: 1,
			});

			expect(result.success).toBeFalse();
			expect(calls).toBeEmpty();
		});

		it("should append github's error body to the invalid-PATCH-body reason on 422", async () => {
			expect.assertions(1);

			const { fetchFn } = fakeFetch(
				() => new Response('{"message":"Validation Failed"}', { status: 422 }),
			);
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.write({
				environment: "production",
				resources: [],
				version: 1,
			});

			assert(!result.success);

			expect(result.err.reason).toBe(
				'invalid PATCH body sent to github (body: {"message":"Validation Failed"})',
			);
		});

		it("should err with an invalid-PATCH-body reason on 422 from write", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => emptyResponse(422));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.write({
				environment: "production",
				resources: [],
				version: 1,
			});

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.reason).toMatch(/invalid PATCH body/u);
		});

		it("should err on auth failure during write", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => emptyResponse(403));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.write({
				environment: "production",
				resources: [],
				version: 1,
			});

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.reason).toMatch(/auth failed/u);
		});

		it("should err on network failure during write", async () => {
			expect.assertions(2);

			async function throwingFetchAsync(): Promise<Response> {
				throw new Error("connection reset");
			}

			const port = createGistStateAdapter({
				fetch: throwingFetchAsync,
				gistId: GIST_ID,
				token: TOKEN,
			});

			const result = await port.write({
				environment: "production",
				resources: [],
				version: 1,
			});

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.reason).toMatch(/network error/u);
		});

		it("should retry the PATCH on 409 and succeed on the second attempt", async () => {
			expect.assertions(3);

			const { calls, fetchFn } = fakeFetchSequence([
				emptyResponse(409),
				emptyResponse(200),
				okJson({ files: { "state.production.json": { content: PRODUCTION_CONTENT } } }),
			]);
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				random: fakeRandom(),
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.write({
				environment: "production",
				resources: [],
				version: 1,
			});

			expect(result.success).toBeTrue();
			expect(calls).toHaveLength(3);
			expect(sleepFake.calls).toStrictEqual([250]);
		});

		it("should retry a throttled PATCH and succeed on the second attempt", async () => {
			expect.assertions(3);

			const { calls, fetchFn } = fakeFetchSequence([
				throttled({ "Retry-After": "2" }),
				emptyResponse(200),
				okJson({ files: { "state.production.json": { content: PRODUCTION_CONTENT } } }),
			]);
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				random: fakeRandom(),
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.write({
				environment: "production",
				resources: [],
				version: 1,
			});

			expect(result.success).toBeTrue();
			expect(calls).toHaveLength(3);
			expect(sleepFake.calls).toStrictEqual([2000]);
		});

		it("should err with the github-returned-409 reason after exhausting the retry budget", async () => {
			expect.assertions(4);

			const { calls, fetchFn } = fakeFetchSequence([
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
			]);
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				random: fakeRandom(),
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.write({
				environment: "production",
				resources: [],
				version: 1,
			});

			assert(!result.success);

			expect(result.err.reason).toMatch(/github returned 409/u);
			expect(result.err.file).toBe(`gist:${GIST_ID}/state.production.json`);
			expect(calls).toHaveLength(7);
			expect(sleepFake.calls).toStrictEqual([250, 500, 1000, 2000, 4000, 8000]);
		});

		it("should jitter retry backoff via the injected random source", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetchSequence([
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
			]);
			const sleepFake = fakeSleep();
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				random: fakeRandom([1]),
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			const result = await port.write({
				environment: "production",
				resources: [],
				version: 1,
			});

			assert(!result.success);

			expect(result.err.reason).toMatch(/github returned 409/u);
			expect(sleepFake.calls).toStrictEqual([500, 1000, 2000, 4000, 8000, 16_000]);
		});

		it("should sleep using setTimeout by default when sleep is not injected", async () => {
			expect.assertions(3);

			vi.useFakeTimers();
			onTestFinished(() => {
				vi.useRealTimers();
			});

			const { calls, fetchFn } = fakeFetchSequence([
				emptyResponse(409),
				emptyResponse(200),
				okJson({ files: { "state.production.json": { content: PRODUCTION_CONTENT } } }),
			]);
			const port = createGistStateAdapter({
				fetch: fetchFn,
				gistId: GIST_ID,
				token: TOKEN,
			});

			const writePromise = port.write({
				environment: "production",
				resources: [],
				version: 1,
			});

			await vi.advanceTimersByTimeAsync(0);

			expect(calls).toHaveLength(1);

			await vi.advanceTimersByTimeAsync(1000);

			const result = await writePromise;

			expect(result.success).toBeTrue();
			expect(calls).toHaveLength(3);
		});

		it.for<[number, RegExp]>([
			[401, /auth failed/u],
			[403, /auth failed/u],
			[404, /not found/u],
			[422, /invalid PATCH body/u],
		])(
			"should not retry write on %i and surface the error in a single attempt",
			async ([status, reasonPattern]) => {
				expect.assertions(3);

				const { calls, fetchFn } = fakeFetch(() => emptyResponse(status));
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.write({
					environment: "production",
					resources: [],
					version: 1,
				});

				assert(!result.success);

				expect(result.err.reason).toMatch(reasonPattern);
				expect(calls).toHaveLength(1);
				expect(sleepFake.calls).toBeEmpty();
			},
		);

		it.for<[number]>([[502], [503], [504]])(
			"should retry the PATCH on %i and succeed on the second attempt",
			async ([status]) => {
				expect.assertions(3);

				const { calls, fetchFn } = fakeFetchSequence([
					emptyResponse(status),
					emptyResponse(200),
					okJson({ files: { "state.production.json": { content: PRODUCTION_CONTENT } } }),
				]);
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					random: fakeRandom(),
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.write({
					environment: "production",
					resources: [],
					version: 1,
				});

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(3);
				expect(sleepFake.calls).toStrictEqual([250]);
			},
		);

		describe("read-after-write visibility", () => {
			it("should not resolve write until the written file is visible on a subsequent GET", async () => {
				expect.assertions(5);

				const written: BedrockState = {
					environment: "production",
					resources: [],
					version: 1,
				};
				const { calls, fetchFn } = fakeFetchSequence([
					emptyResponse(200),
					okJson({ files: {} }),
					okJson({
						files: {
							"state.production.json": { content: serializeStateFile(written) },
						},
					}),
				]);
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.write(written);

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(3);
				expect(calls[0]!.method).toBe("PATCH");
				expect(calls[1]!.method).toBe("GET");
				expect(calls[2]!.method).toBe("GET");
			});

			it("should keep polling while the file is present but its content is stale from a prior write", async () => {
				expect.assertions(3);

				const written: BedrockState = {
					environment: "production",
					resources: [],
					version: 1,
				};
				const { calls, fetchFn } = fakeFetchSequence([
					emptyResponse(200),
					okJson({
						files: { "state.production.json": { content: "stale prior content" } },
					}),
					okJson({
						files: {
							"state.production.json": { content: serializeStateFile(written) },
						},
					}),
				]);
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.write(written);

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(3);
				expect(calls[2]!.method).toBe("GET");
			});

			it("should resolve write without polling further when the file is already visible on the first GET", async () => {
				expect.assertions(3);

				const written: BedrockState = {
					environment: "production",
					resources: [],
					version: 1,
				};
				const { calls, fetchFn } = fakeFetchSequence([
					emptyResponse(200),
					okJson({
						files: {
							"state.production.json": { content: serializeStateFile(written) },
						},
					}),
				]);
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.write(written);

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(2);
				expect(sleepFake.calls).toBeEmpty();
			});

			it("should resolve write success after exhausting the visibility budget", async () => {
				expect.assertions(3);

				const { calls, fetchFn } = fakeGistFetch({
					get: okJson({ files: {} }),
					patch: emptyResponse(200),
				});
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.write({
					environment: "production",
					resources: [],
					version: 1,
				});

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(6);
				expect(sleepFake.calls).toStrictEqual([250, 500, 1000, 2000]);
			});

			it("should treat a transient non-ok GET as 'not yet visible' and keep polling", async () => {
				expect.assertions(2);

				const written: BedrockState = {
					environment: "production",
					resources: [],
					version: 1,
				};
				const { calls, fetchFn } = fakeFetchSequence([
					emptyResponse(200),
					emptyResponse(503),
					okJson({
						files: {
							"state.production.json": { content: serializeStateFile(written) },
						},
					}),
				]);
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.write(written);

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(3);
			});

			it("should resolve write success when the injected sleep rejects during visibility polling", async () => {
				expect.assertions(2);

				const { calls, fetchFn } = fakeGistFetch({
					get: okJson({ files: {} }),
					patch: emptyResponse(200),
				});
				async function rejectingSleepAsync(): Promise<void> {
					throw new Error("aborted");
				}

				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: rejectingSleepAsync,
					token: TOKEN,
				});

				const result = await port.write({
					environment: "production",
					resources: [],
					version: 1,
				});

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(2);
			});

			it("should treat a thrown visibility GET as 'not yet visible' and keep polling", async () => {
				expect.assertions(2);

				const written: BedrockState = {
					environment: "production",
					resources: [],
					version: 1,
				};
				const { calls, fetchFn } = fakeGistFetch({
					get: [
						new Error("transient connection reset"),
						okJson({
							files: {
								"state.production.json": { content: serializeStateFile(written) },
							},
						}),
					],
					patch: emptyResponse(200),
				});
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.write(written);

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(3);
			});

			it("should keep polling when a present file carries no readable content", async () => {
				expect.assertions(3);

				const { calls, fetchFn } = fakeGistFetch({
					get: okJson({ files: { "state.production.json": {} } }),
					patch: emptyResponse(200),
				});
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.write(PRODUCTION_STATE);

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(6);
				expect(sleepFake.calls).toStrictEqual([250, 500, 1000, 2000]);
			});

			it("should replay a stale replica's ETag on later polls so 304s and missing-etag GETs stay conditional", async () => {
				expect.assertions(5);

				const written: BedrockState = {
					environment: "production",
					resources: [],
					version: 1,
				};
				const staleEtag = 'W/"stale-replica-etag"';
				function staleFile(headers: Record<string, string> = {}): Response {
					return new Response(
						JSON.stringify({
							files: { "state.production.json": { content: "stale prior content" } },
						}),
						{ headers, status: 200 },
					);
				}

				const { calls, fetchFn } = fakeFetchSequence([
					emptyResponse(200),
					staleFile({ etag: staleEtag }),
					new Response(undefined, { status: 304 }),
					staleFile(),
					okJson({
						files: {
							"state.production.json": { content: serializeStateFile(written) },
						},
					}),
				]);
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.write(written);

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(5);
				// First poll has no baseline ETag, so it is unconditional.
				expect(calls[1]!.headers.get("if-none-match")).toBeNull();
				// Captured ETag is replayed so a still-stale replica answers 304.
				expect(calls[2]!.headers.get("if-none-match")).toBe(staleEtag);
				// Retained across the 304 and a later etag-less stale 200.
				expect(calls[4]!.headers.get("if-none-match")).toBe(staleEtag);
			});

			it("should keep polling when a present file's value is malformed (non-object)", async () => {
				expect.assertions(3);

				const { calls, fetchFn } = fakeGistFetch({
					get: okJson({ files: { "state.production.json": "unexpected string entry" } }),
					patch: emptyResponse(200),
				});
				const sleepFake = fakeSleep();
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.write(PRODUCTION_STATE);

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(6);
				expect(sleepFake.calls).toStrictEqual([250, 500, 1000, 2000]);
			});
		});
	});
});
