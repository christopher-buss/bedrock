import { type } from "arktype";
import { assert, describe, expect, it } from "vitest";

import { environmentFrom } from "#tests/helpers/environment";
import { fakeFetch } from "#tests/helpers/fake-gist-fetch";
import { fakeStateBackendPlugins } from "#tests/helpers/plugins";
import { neverForceReleaseAsync, neverInspectAsync } from "#tests/helpers/state-lock";
import type { StateConfig } from "../core/schema.ts";
import type { StateLockingCapability } from "../core/state-locking.ts";
import type { StatePort } from "../ports/state-port.ts";
import { buildStateBackend, buildStatePort } from "./build-state-port.ts";

const GIST_CONFIG: StateConfig = { backend: "gist", gistId: "abc123" };

async function neverFetchAsync(): Promise<Response> {
	return new Response("", { status: 500 });
}

function emptyFilesResponse(): Response {
	return new Response(JSON.stringify({ files: {} }), { status: 200 });
}

async function neverAcquireAsync(): Promise<never> {
	throw new Error("the lock port must not be acquired by capability reporting");
}

function okPort(): StatePort {
	return {
		read: async () => ({ data: {}, success: true }),
		write: async () => ({ data: undefined, success: true }),
	};
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
			read: async () => ({ data: {}, success: true }) as const,
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
			data: {},
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

	it("should dispatch a builtin backend name to its builtin adapter even when a plugin claims that name", () => {
		expect.assertions(1);

		// A config load rejects this collision, so the registry can only
		// hold it when something skipped that check. Dispatch still has to
		// keep the builtin, or a plugin becomes a way to redirect state.
		const result = buildStatePort({
			fetch: neverFetchAsync,
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			plugins: fakeStateBackendPlugins({
				name: "gist",
				createPort: () => ({ err: { reason: "unreachable" }, success: false }),
				schema: type({ gistId: "string > 0" }),
				specifier: "@example/state-gist",
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

describe(buildStateBackend, () => {
	it("should yield no lock port for the gist backend, which declares no locking", () => {
		expect.assertions(1);

		const result = buildStateBackend({
			fetch: neverFetchAsync,
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			stateConfig: GIST_CONFIG,
		});

		assert(result.success);

		expect(result.data.stateLockPort).toBeUndefined();
	});

	it("should build the lock port a plugin backend declares", async () => {
		expect.assertions(1);

		const hold = { release: async () => ({ data: undefined, success: true }) as const };

		const result = buildStateBackend({
			getEnv: environmentFrom({}),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createLockPort: () => {
					return {
						data: {
							acquire: async () => ({ data: hold, success: true }) as const,
							forceRelease: neverForceReleaseAsync,
							inspect: neverInspectAsync,
						},
						success: true,
					};
				},
				createPort: () => ({ data: okPort(), success: true }),
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			stateConfig: { backend: "s3", bucket: "my-bucket" },
		});

		assert(result.success);
		assert(result.data.stateLockPort !== undefined);

		await expect(result.data.stateLockPort.acquire("production")).resolves.toStrictEqual({
			data: hold,
			success: true,
		});
	});

	it("should yield no lock port for a plugin backend that declares no lock builder", () => {
		expect.assertions(1);

		const result = buildStateBackend({
			getEnv: environmentFrom({}),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createPort: () => ({ data: okPort(), success: true }),
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			stateConfig: { backend: "s3", bucket: "my-bucket" },
		});

		assert(result.success);

		expect(result.data.stateLockPort).toBeUndefined();
	});

	it("should not ask a plugin backend for a lock port when the config turned locking off", () => {
		expect.assertions(2);

		let asked = false;

		const result = buildStateBackend({
			getEnv: environmentFrom({}),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createLockPort: () => {
					asked = true;
					return { err: { reason: "unused" }, success: false };
				},
				createPort: () => ({ data: okPort(), success: true }),
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			stateConfig: { backend: "s3", bucket: "my-bucket", locking: false },
		});

		assert(result.success);

		expect(result.data.stateLockPort).toBeUndefined();
		expect(asked).toBeFalse();
	});

	it.for([
		{
			expected: "exclusive",
			label: "a backend that locks and a config that left locking on",
			stateConfig: { backend: "s3", bucket: "my-bucket" },
		},
		{
			expected: "disabled",
			label: "a backend that locks and a config that turned locking off",
			stateConfig: { backend: "s3", bucket: "my-bucket", locking: false },
		},
	] satisfies ReadonlyArray<{
		expected: StateLockingCapability;
		label: string;
		stateConfig: StateConfig;
	}>)("should report $expected exclusion for $label", ({ expected, stateConfig }) => {
		expect.assertions(1);

		const result = buildStateBackend({
			getEnv: environmentFrom({}),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createLockPort: () => {
					return {
						data: {
							acquire: neverAcquireAsync,
							forceRelease: neverForceReleaseAsync,
							inspect: neverInspectAsync,
						},
						success: true,
					};
				},
				createPort: () => ({ data: okPort(), success: true }),
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			stateConfig,
		});

		assert(result.success);

		expect(result.data.locking).toBe(expected);
	});

	it("should report no exclusion for the gist backend", () => {
		expect.assertions(1);

		const result = buildStateBackend({
			fetch: neverFetchAsync,
			getEnv: environmentFrom({ BEDROCK_GITHUB_TOKEN: "ghp_test" }),
			stateConfig: GIST_CONFIG,
		});

		assert(result.success);

		expect(result.data.locking).toBe("none");
	});

	it("should hand the plugin's lock builder the state block, the credential reader, and the fetch seam", () => {
		expect.assertions(3);

		const { fetchFn } = fakeFetch(emptyFilesResponse);
		const seen: Array<unknown> = [];

		buildStateBackend({
			fetch: fetchFn,
			getEnv: environmentFrom({ AWS_ACCESS_KEY_ID: "example-access-key" }),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createLockPort: (context) => {
					seen.push(
						context.stateConfig,
						context.getEnv("AWS_ACCESS_KEY_ID"),
						context.fetch,
					);
					return { err: { reason: "unused" }, success: false };
				},
				createPort: () => ({ data: okPort(), success: true }),
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			stateConfig: { backend: "s3", bucket: "my-bucket" },
		});

		expect(seen[0]).toStrictEqual({ backend: "s3", bucket: "my-bucket" });
		expect(seen[1]).toBe("example-access-key");
		expect(seen[2]).toBe(fetchFn);
	});

	it("should wrap a plugin lock-builder failure in pluginStateBackend naming the plugin and keeping its payload", () => {
		expect.assertions(3);

		const result = buildStateBackend({
			getEnv: environmentFrom({}),
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createLockPort: () => {
					return {
						err: { detail: { table: "locks" }, reason: "lock table unreachable" },
						success: false,
					};
				},
				createPort: () => ({ data: okPort(), success: true }),
				schema: type({ bucket: "string > 0" }),
				specifier: "@example/state-s3",
			}),
			stateConfig: { backend: "s3", bucket: "my-bucket" },
		});

		assert(!result.success);
		assert(result.err.kind === "pluginStateBackend");

		expect(result.err.specifier).toBe("@example/state-s3");
		expect(result.err.reason).toBe("lock table unreachable");
		expect(result.err.detail).toStrictEqual({ table: "locks" });
	});
});
