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
		it("should send a GET to the gists endpoint with the correct headers", async () => {
			expect.assertions(5);

			const { calls, fetchFn } = fakeFetch(() => okJson({ files: {} }));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			await port.read("production");

			expect(calls).toHaveLength(1);

			const request = calls[0]!;

			expect(request.url).toBe(`https://api.github.com/gists/${GIST_ID}`);
			expect(request.method).toBe("GET");
			expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
			expect(request.headers.get("x-github-api-version")).toBe("2026-03-10");
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
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => emptyResponse(404));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.reason).toMatch(/gist .* not found/u);
		});

		it("should err with an auth reason on 401 or 403", async () => {
			expect.assertions(2);

			const { fetchFn } = fakeFetch(() => emptyResponse(401));
			const port = createGistStateAdapter({ fetch: fetchFn, gistId: GIST_ID, token: TOKEN });

			const result = await port.read("production");

			expect(result.success).toBeFalse();

			assert(!result.success);

			expect(result.err.reason).toMatch(/auth failed/u);
		});

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
							size: 12_000_000,
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
});
