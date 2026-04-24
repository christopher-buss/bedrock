import { assert, describe, expect, it } from "vitest";

import { serializeStateFile } from "../core/state-file.ts";
import type { BedrockState } from "../core/state.ts";
import { createGistStateAdapter, type GistFetch } from "./gist-state-adapter.ts";

const GIST_ID = "abc123def456";
const TOKEN = "ghp_example_token";

interface FakeFetch {
	readonly calls: Array<Request>;
	readonly fetchFn: GistFetch;
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
				if (request.url.startsWith("https://api.github.com")) {
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
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

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
				if (request.url.startsWith("https://api.github.com")) {
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
				if (request.url.startsWith("https://api.github.com")) {
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
	});

	describe("write", () => {
		it("should PATCH the gist with the serialized state file on write", async () => {
			expect.assertions(4);

			const { calls, fetchFn } = fakeFetch(() => emptyResponse(200));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.write({
				environment: "production",
				resources: [],
				version: 1,
			});

			expect(result.success).toBeTrue();
			expect(calls).toHaveLength(1);

			const request = calls[0]!;

			expect(request.method).toBe("PATCH");

			const body = (await request.json()) as { files: Record<string, { content: string }> };

			expect(JSON.parse(body.files["state.production.json"]!.content)).toStrictEqual({
				$bedrock: { version: 1 },
				environment: "production",
				resources: [],
			});
		});

		it("should send a json content-type header on write", async () => {
			expect.assertions(1);

			const { calls, fetchFn } = fakeFetch(() => emptyResponse(200));
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
	});
});
