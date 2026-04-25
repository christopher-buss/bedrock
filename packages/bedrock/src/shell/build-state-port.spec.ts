import { assert, describe, expect, it } from "vitest";

import type { GistFetch } from "../adapters/gist-state-adapter.ts";
import type { StateConfig } from "../core/schema.ts";
import { buildStatePort } from "./build-state-port.ts";

const GIST_CONFIG: StateConfig = { backend: "gist", gistId: "abc123" };

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

function environmentFrom(values: Record<string, string>): (name: string) => string | undefined {
	return (name) => values[name];
}

async function neverFetch(): Promise<Response> {
	return new Response("", { status: 500 });
}

function emptyFilesResponse(): Response {
	return new Response(JSON.stringify({ files: {} }), { status: 200 });
}

describe(buildStatePort, () => {
	it("should construct a gist state port from backend gist using the supplied token", async () => {
		expect.assertions(1);

		const { fetchFn } = fakeFetch(emptyFilesResponse);

		const result = buildStatePort({
			fetch: fetchFn,
			getEnv: environmentFrom({ GITHUB_TOKEN: "ghp_test" }),
			stateConfig: GIST_CONFIG,
		});

		assert(result.success);

		const read = await result.data.read("production");

		expect(read.success).toBeTrue();
	});

	it("should pass the GITHUB_TOKEN value through to the gist adapter as a Bearer token", async () => {
		expect.assertions(1);

		const { calls, fetchFn } = fakeFetch(emptyFilesResponse);

		const result = buildStatePort({
			fetch: fetchFn,
			getEnv: environmentFrom({ GITHUB_TOKEN: "ghp_secret" }),
			stateConfig: GIST_CONFIG,
		});

		assert(result.success);
		await result.data.read("production");

		expect(calls[0]!.headers.get("authorization")).toBe("Bearer ghp_secret");
	});

	it("should return Err(missingCredential) when backend is gist and GITHUB_TOKEN is unset", () => {
		expect.assertions(3);

		const result = buildStatePort({
			fetch: neverFetch,
			getEnv: environmentFrom({}),
			stateConfig: GIST_CONFIG,
		});

		assert(!result.success);
		assert(result.err.kind === "missingCredential");

		expect(result.err.kind).toBe("missingCredential");
		expect(result.err.variable).toBe("GITHUB_TOKEN");
		expect(result.err.purpose).toBe("stateBackend");
	});

	it("should return Err(unsupportedBackend) carrying the offending backend name when backend is not a known builtin", () => {
		expect.assertions(1);

		const result = buildStatePort({
			fetch: neverFetch,
			getEnv: environmentFrom({ GITHUB_TOKEN: "ghp_test" }),
			stateConfig: { backend: "s3" },
		});

		assert(!result.success);
		assert(result.err.kind === "unsupportedBackend");

		expect(result.err.backend).toBe("s3");
	});

	it("should hint at opts.statePort as the escape hatch in the unsupportedBackend Err", () => {
		expect.assertions(1);

		const result = buildStatePort({
			fetch: neverFetch,
			getEnv: environmentFrom({ GITHUB_TOKEN: "ghp_test" }),
			stateConfig: { backend: "s3" },
		});

		assert(!result.success);
		assert(result.err.kind === "unsupportedBackend");

		expect(result.err.hint).toContain("opts.statePort");
	});

	it("should construct the gist adapter without a fetch override when none is supplied", () => {
		expect.assertions(1);

		const result = buildStatePort({
			getEnv: environmentFrom({ GITHUB_TOKEN: "ghp_test" }),
			stateConfig: GIST_CONFIG,
		});

		assert(result.success);

		expect(result.data.read).toBeFunction();
	});
});
