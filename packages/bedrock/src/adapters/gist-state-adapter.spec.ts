import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import { serializeStateFile } from "../core/state-file.ts";
import type { BedrockState } from "../core/state.ts";
import { createGistStateAdapter, type GistFetch } from "./gist-state-adapter.ts";

const GIST_ID = "abc123def456";
const TOKEN = "ghp_example_token";

interface FakeFetch {
	readonly calls: Array<Request>;
	readonly fetchFn: GistFetch;
}

interface FakeSleep {
	readonly calls: Array<number>;
	readonly sleep: (ms: number) => Promise<void>;
}

function fakeFetch(responder: (request: Request) => Promise<Response> | Response): FakeFetch {
	const calls: Array<Request> = [];
	async function fetchFunc(
		input: globalThis.Request | string | URL,
		init?: RequestInit,
	): Promise<Response> {
		const request = new Request(input, init);
		calls.push(request);
		return responder(request);
	}

	return { calls, fetchFn: fetchFunc };
}

function fakeFetchSequence(responses: ReadonlyArray<Response>): FakeFetch {
	let index = 0;
	return fakeFetch(() => {
		const response = responses[index];
		if (response === undefined) {
			throw new Error(`fakeFetchSequence: no response queued for call ${String(index + 1)}`);
		}

		index += 1;
		return response;
	});
}

function fakeSleep(): FakeSleep {
	const calls: Array<number> = [];
	async function sleep(ms: number): Promise<void> {
		calls.push(ms);
	}

	return { calls, sleep };
}

function okJson(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200 });
}

function emptyResponse(status: number): Response {
	return new Response("", { status });
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

		it("should return ok(undefined) when the environment file is absent", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => okJson({ files: {} }));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();

			assert(result.success);

			expect(result.data).toBeUndefined();
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

			expect(result.data).toStrictEqual(state);
		});

		it("should err with a gist-not-found reason when the gist 404s", async () => {
			expect.assertions(3);

			const { fetchFn } = fakeFetch(() => emptyResponse(404));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.reason).toMatch(/gist .* not found/u);
			expect(result.err.file).toBe(`gist:${GIST_ID}/state.production.json`);
		});

		it.for<[number]>([[401], [403]])(
			"should err with an auth reason on %i",
			async ([status]) => {
				expect.assertions(2);

				const { fetchFn } = fakeFetch(() => emptyResponse(status));
				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					token: TOKEN,
				});

				const result = await port.read("production");

				expect(result.success).toBeFalse();

				assert(!result.success);

				expect(result.err.reason).toMatch(/auth failed/u);
			},
		);

		it("should err with a network-error reason when fetch throws", async () => {
			expect.assertions(2);

			async function throwingFetch(): Promise<Response> {
				throw new Error("connection reset");
			}

			const port = createGistStateAdapter({
				fetch: throwingFetch,
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

			const { fetchFn } = fakeFetch((request) => {
				const url = new URL(request.url);
				if (url.protocol === "https:" && url.hostname === "api.github.com") {
					return okJson({
						files: {
							"state.production.json": {
								content: "",
								raw_url: "https://gist.example/raw/abc",
								size: 2_000_000,
								truncated: true,
							},
						},
					});
				}

				throw new Error("connection reset");
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

		it("should return ok(undefined) when the files dict is missing on the gist response", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => okJson({}));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();

			assert(result.success);

			expect(result.data).toBeUndefined();
		});

		it("should return ok(undefined) when the file entry is null in the gist response", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(
				() => new Response('{"files":{"state.production.json":null}}', { status: 200 }),
			);
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();

			assert(result.success);

			expect(result.data).toBeUndefined();
		});

		it("should return ok(undefined) when the file entry is a non-object primitive", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => {
				return okJson({ files: { "state.production.json": "not-an-object" } });
			});
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();

			assert(result.success);

			expect(result.data).toBeUndefined();
		});

		it("should err with a raw_url-fetch-returned reason when the cdn returns non-ok", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch((request) => {
				const url = new URL(request.url);
				if (url.protocol === "https:" && url.hostname === "api.github.com") {
					return okJson({
						files: {
							"state.production.json": {
								content: "",
								raw_url: "https://gist.example/raw/abc",
								size: 2_000_000,
								truncated: true,
							},
						},
					});
				}

				return emptyResponse(503);
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
			const { fetchFn } = fakeFetch((request) => {
				const url = new URL(request.url);
				if (url.protocol === "https:" && url.hostname === "api.github.com") {
					return okJson({
						files: {
							"state.production.json": {
								content: "",
								raw_url: "https://gist.example/raw/abc",
								size: 10_000_000,
								truncated: true,
							},
						},
					});
				}

				return new Response(content, { status: 200 });
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
			const { fetchFn } = fakeFetch((request) => {
				const url = new URL(request.url);
				if (url.protocol === "https:" && url.hostname === "api.github.com") {
					return okJson({
						files: {
							"state.production.json": {
								content: "",
								raw_url: "https://gist.example/raw/abc",
								size: 2_000_000,
								truncated: true,
							},
						},
					});
				}

				return new Response(content, { status: 200 });
			});
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeTrue();

			assert(result.success);

			expect(result.data).toStrictEqual(state);
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
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.read("production");

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(2);
				expect(sleepFake.calls).toStrictEqual([1000]);
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
					sleep: sleepFake.sleep,
					token: TOKEN,
				});

				const result = await port.read("production");

				expect(result.success).toBeTrue();
				expect(calls).toHaveLength(3);
				expect(sleepFake.calls).toStrictEqual([1000]);
			},
		);
	});

	describe("write", () => {
		it("should PATCH the gist with the serialized state file on write", async () => {
			expect.assertions(3);

			const { calls, fetchFn } = fakeFetch((request) => {
				return request.method === "PATCH"
					? emptyResponse(200)
					: okJson({ files: { "state.production.json": { content: "{}" } } });
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

			const body = (await patchRequest.json()) as {
				files: Record<string, { content: string }>;
			};

			expect(JSON.parse(body.files["state.production.json"]!.content)).toStrictEqual({
				$bedrock: { version: 1 },
				environment: "production",
				resources: [],
			});
		});

		it("should send a json content-type header on write", async () => {
			expect.assertions(1);

			const { calls, fetchFn } = fakeFetch((request) => {
				return request.method === "PATCH"
					? emptyResponse(200)
					: okJson({ files: { "state.production.json": { content: "{}" } } });
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

			async function throwingFetch(): Promise<Response> {
				throw new Error("connection reset");
			}

			const port = createGistStateAdapter({
				fetch: throwingFetch,
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
				okJson({ files: { "state.production.json": { content: "{}" } } }),
			]);
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
			expect(calls).toHaveLength(3);
			expect(sleepFake.calls).toStrictEqual([1000]);
		});

		it("should err with the github-returned-409 reason after exhausting the retry budget", async () => {
			expect.assertions(4);

			const { calls, fetchFn } = fakeFetchSequence([
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
				emptyResponse(409),
			]);
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

			expect(result.err.reason).toMatch(/github returned 409/u);
			expect(result.err.file).toBe(`gist:${GIST_ID}/state.production.json`);
			expect(calls).toHaveLength(4);
			expect(sleepFake.calls).toStrictEqual([1000, 2000, 4000]);
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
				okJson({ files: { "state.production.json": { content: "{}" } } }),
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
					okJson({ files: { "state.production.json": { content: "{}" } } }),
				]);
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
				expect(calls).toHaveLength(3);
				expect(sleepFake.calls).toStrictEqual([1000]);
			},
		);

		describe("read-after-write visibility", () => {
			it("should not resolve write until the written file is visible on a subsequent GET", async () => {
				expect.assertions(5);

				const { calls, fetchFn } = fakeFetchSequence([
					emptyResponse(200),
					okJson({ files: {} }),
					okJson({ files: { "state.production.json": { content: "{}" } } }),
				]);
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
				expect(calls).toHaveLength(3);
				expect(calls[0]!.method).toBe("PATCH");
				expect(calls[1]!.method).toBe("GET");
				expect(calls[2]!.method).toBe("GET");
			});

			it("should resolve write without polling further when the file is already visible on the first GET", async () => {
				expect.assertions(3);

				const { calls, fetchFn } = fakeFetchSequence([
					emptyResponse(200),
					okJson({ files: { "state.production.json": { content: "{}" } } }),
				]);
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
				expect(calls).toHaveLength(2);
				expect(sleepFake.calls).toBeEmpty();
			});

			it("should resolve write success after exhausting the visibility budget", async () => {
				expect.assertions(3);

				const { calls, fetchFn } = fakeFetch((request) => {
					if (request.method === "PATCH") {
						return emptyResponse(200);
					}

					return okJson({ files: {} });
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

				const { calls, fetchFn } = fakeFetchSequence([
					emptyResponse(200),
					emptyResponse(503),
					okJson({ files: { "state.production.json": { content: "{}" } } }),
				]);
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
				expect(calls).toHaveLength(3);
			});

			it("should resolve write success when the injected sleep rejects during visibility polling", async () => {
				expect.assertions(2);

				const { calls, fetchFn } = fakeFetch((request) => {
					return request.method === "PATCH" ? emptyResponse(200) : okJson({ files: {} });
				});
				async function rejectingSleep(): Promise<void> {
					throw new Error("aborted");
				}

				const port = createGistStateAdapter({
					fetch: fetchFn,
					gistId: GIST_ID,
					sleep: rejectingSleep,
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

				let getCount = 0;
				const { calls, fetchFn } = fakeFetch((request) => {
					if (request.method === "PATCH") {
						return emptyResponse(200);
					}

					getCount += 1;
					if (getCount === 1) {
						throw new Error("transient connection reset");
					}

					return okJson({ files: { "state.production.json": { content: "{}" } } });
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
				expect(calls).toHaveLength(3);
			});
		});
	});
});
