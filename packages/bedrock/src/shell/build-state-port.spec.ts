import { type } from "arktype";
import { assert, describe, expect, it } from "vitest";

import { environmentFrom } from "#tests/helpers/environment";
import { fakeFetch } from "#tests/helpers/fake-gist-fetch";
import { fakeStateBackendPlugins } from "#tests/helpers/plugins";
import type { StateConfig } from "../core/schema.ts";
import { buildStatePort } from "./build-state-port.ts";

const GIST_CONFIG: StateConfig = { backend: "gist", gistId: "abc123" };

async function neverFetchAsync(): Promise<Response> {
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
			fetch: neverFetchAsync,
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
			fetch: neverFetchAsync,
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
			fetch: neverFetchAsync,
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			stateConfig: { backend: "s3" },
		});

		assert(!result.success);
		assert(result.err.kind === "unsupportedBackend");

		expect(result.err.hint).toContain("opts.statePort");
	});

	it("should construct a state port from a plugin-declared backend", async () => {
		expect.assertions(1);

		const port = {
			read: async () => ({ data: undefined, success: true }) as const,
			write: async () => ({ data: undefined, success: true }) as const,
		};

		const result = buildStatePort({
			getEnv: environmentFrom({}),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createPort: () => ({ data: port, success: true }),
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			stateConfig: { backend: "s3", bucket: "my-bucket" },
		});

		assert(result.success);

		await expect(result.data.read("production")).resolves.toStrictEqual({
			data: undefined,
			success: true,
		});
	});

	it("should hand the plugin's builder the state block, the credential reader, and the fetch seam", () => {
		expect.assertions(3);

		const { fetchFn } = fakeFetch(emptyFilesResponse);
		const seen: Array<unknown> = [];

		buildStatePort({
			fetch: fetchFn,
			getEnv: environmentFrom({ AWS_ACCESS_KEY_ID: "example-access-key" }),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createPort: (context) => {
					seen.push(
						context.stateConfig,
						context.getEnv("AWS_ACCESS_KEY_ID"),
						context.fetch,
					);
					return { err: { reason: "unused" }, success: false };
				},
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			stateConfig: { backend: "s3", bucket: "my-bucket" },
		});

		expect(seen[0]).toStrictEqual({ backend: "s3", bucket: "my-bucket" });
		expect(seen[1]).toBe("example-access-key");
		expect(seen[2]).toBe(fetchFn);
	});

	it("should wrap a plugin builder failure in pluginStateBackend naming the plugin and keeping its payload", () => {
		expect.assertions(3);

		const result = buildStatePort({
			getEnv: environmentFrom({}),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createPort: () => {
					return {
						err: {
							detail: { variable: "AWS_ACCESS_KEY_ID" },
							reason: "no credentials",
						},
						success: false,
					};
				},
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			stateConfig: { backend: "s3", bucket: "my-bucket" },
		});

		assert(!result.success);
		assert(result.err.kind === "pluginStateBackend");

		expect(result.err.specifier).toBe("@example/state-s3");
		expect(result.err.reason).toBe("no credentials");
		expect(result.err.detail).toStrictEqual({ variable: "AWS_ACCESS_KEY_ID" });
	});

	it("should keep dispatching a builtin backend name to its builtin adapter when plugins are loaded", () => {
		expect.assertions(1);

		const result = buildStatePort({
			fetch: neverFetchAsync,
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createPort: () => ({ err: { reason: "unreachable" }, success: false }),
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			stateConfig: GIST_CONFIG,
		});

		expect(result.success).toBeTrue();
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
