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
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			stateConfig: GIST_CONFIG,
		});

		assert(result.success);

		const read = await result.data.read("production");

		expect(read.success).toBeTrue();
	});

	it.for([
		{
			env: { BEDROCK_GITHUB_TOKEN: "ghp_preferred" },
			expectedBearer: "Bearer ghp_preferred",
			label: "BEDROCK_GITHUB_TOKEN",
		},
		{
			env: { GITHUB_TOKEN: "ghp_legacy" },
			expectedBearer: "Bearer ghp_legacy",
			label: "GITHUB_TOKEN as fallback",
		},
		{
			env: { BEDROCK_GITHUB_TOKEN: "ghp_preferred", GITHUB_TOKEN: "ghp_legacy" },
			expectedBearer: "Bearer ghp_preferred",
			label: "BEDROCK_GITHUB_TOKEN over GITHUB_TOKEN when both are set",
		},
	])(
		"should send the credential resolved from $label as a Bearer token",
		async ({ env, expectedBearer }) => {
			expect.assertions(1);

			const { calls, fetchFn } = fakeFetch(emptyFilesResponse);

			const result = buildStatePort({
				fetch: fetchFn,
				getEnv: environmentFrom(env),
				stateConfig: GIST_CONFIG,
			});

			assert(result.success);
			await result.data.read("production");

			expect(calls[0]!.headers.get("authorization")).toBe(expectedBearer);
		},
	);

	it("should return Err(missingCredential) naming BEDROCK_GITHUB_TOKEN when no credential env var is set", () => {
		expect.assertions(3);

		const result = buildStatePort({
			fetch: neverFetch,
			getEnv: environmentFrom({}),
			stateConfig: GIST_CONFIG,
		});

		assert(!result.success);
		assert(result.err.kind === "missingCredential");

		expect(result.err.kind).toBe("missingCredential");
		expect(result.err.variable).toBe("BEDROCK_GITHUB_TOKEN");
		expect(result.err.purpose).toBe("stateBackend");
	});

	it("should return Err(unsupportedBackend) carrying the offending backend name when backend is not a known builtin", () => {
		expect.assertions(1);

		const result = buildStatePort({
			fetch: neverFetch,
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
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
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			stateConfig: { backend: "s3" },
		});

		assert(!result.success);
		assert(result.err.kind === "unsupportedBackend");

		expect(result.err.hint).toContain("opts.statePort");
	});

	it("should construct the gist adapter without a fetch override when none is supplied", () => {
		expect.assertions(1);

		const result = buildStatePort({
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			stateConfig: GIST_CONFIG,
		});

		assert(result.success);

		expect(result.data.read).toBeFunction();
	});
});
