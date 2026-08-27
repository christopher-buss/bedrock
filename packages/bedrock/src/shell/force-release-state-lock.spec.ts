import { type } from "arktype";
import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import { environmentFrom } from "#tests/helpers/environment";
import { fakeStateBackendPlugins } from "#tests/helpers/plugins";
import { neverInspectAsync } from "#tests/helpers/state-lock";
import type { Config } from "../core/schema.ts";
import type { StateLockHolding, StateLockPort } from "../ports/state-lock-port.ts";
import type { StatePort } from "../ports/state-port.ts";
import { forceReleaseStateLockAsync } from "./force-release-state-lock.ts";

const S3_SCHEMA = type({ bucket: "string > 0" });

const HOLDER: StateLockHolding = {
	operation: "deploy",
	owner: "ci-run-7",
	since: "2026-08-27T10:00:00.000Z",
};

function neverStatePort(): StatePort {
	return {
		read: async () => ({ data: {}, success: true }),
		write: async () => ({ data: undefined, success: true }),
	};
}

/**
 * Build a lock port whose force-release displaces the holder a test named.
 *
 * @param displaced - Who the release reports it displaced.
 * @returns The port plus the environments it was asked to release.
 */
function releasingLockPort(displaced: StateLockHolding | undefined): {
	port: StateLockPort;
	released: Array<string>;
} {
	const released: Array<string> = [];
	return {
		port: {
			async acquire() {
				throw new Error("a force release must not take a hold");
			},
			async forceRelease(environment) {
				released.push(environment);
				return { data: displaced, success: true };
			},
			inspect: neverInspectAsync,
		},
		released,
	};
}

function s3Config(): Config {
	return {
		environments: { production: {} },
		state: { backend: "s3", bucket: "my-bucket" },
	};
}

function lockingOffConfig(): Config {
	return {
		environments: { production: {} },
		state: { backend: "s3", bucket: "my-bucket", locking: false },
	};
}

function pluginsWith(port: StateLockPort) {
	return fakeStateBackendPlugins({
		name: "s3",
		createLockPort: () => ({ data: port, success: true }),
		createPort: () => ({ data: neverStatePort(), success: true }),
		schema: S3_SCHEMA,
		specifier: "@example/state-s3",
	});
}

describe(forceReleaseStateLockAsync, () => {
	it("should release the hold and report the holder it displaced", async () => {
		expect.assertions(3);

		const lock = releasingLockPort(HOLDER);

		const result = await forceReleaseStateLockAsync({
			config: s3Config(),
			environment: "production",
			getEnv: environmentFrom({}),
			plugins: pluginsWith(lock.port),
		});

		assert(result.success);

		expect(result.data.displaced).toStrictEqual(HOLDER);
		expect(result.data.locking).toBe("exclusive");
		expect(lock.released).toStrictEqual(["production"]);
	});

	it("should report an environment nothing was holding", async () => {
		expect.assertions(1);

		const result = await forceReleaseStateLockAsync({
			config: s3Config(),
			environment: "production",
			getEnv: environmentFrom({}),
			plugins: pluginsWith(releasingLockPort(undefined).port),
		});

		assert(result.success);

		expect(result.data.displaced).toBeUndefined();
	});

	it("should release nothing on a backend that takes no hold, credential or not", async () => {
		expect.assertions(2);

		// No credential: an operator asking to take a hold away should be
		// told there is none to take rather than told to go and find a
		// token first.
		const result = await forceReleaseStateLockAsync({
			config: { environments: { production: {} }, state: { backend: "gist", gistId: "abc" } },
			environment: "production",
			getEnv: environmentFrom({}),
		});

		assert(result.success);

		expect(result.data.locking).toBe("none");
		expect(result.data.displaced).toBeUndefined();
	});

	it("should release nothing when the config turned locking off", async () => {
		expect.assertions(2);

		const lock = releasingLockPort(HOLDER);

		const result = await forceReleaseStateLockAsync({
			config: lockingOffConfig(),
			environment: "production",
			getEnv: environmentFrom({}),
			plugins: pluginsWith(lock.port),
		});

		assert(result.success);

		expect(result.data.locking).toBe("disabled");
		expect(lock.released).toBeEmpty();
	});

	it("should surface a hold the backend refused to release", async () => {
		expect.assertions(2);

		const result = await forceReleaseStateLockAsync({
			config: s3Config(),
			environment: "production",
			getEnv: environmentFrom({}),
			plugins: pluginsWith({
				async acquire() {
					throw new Error("a force release must not take a hold");
				},
				async forceRelease() {
					return { err: { reason: "the lock store was unreachable" }, success: false };
				},
				inspect: neverInspectAsync,
			}),
		});

		assert(!result.success);
		assert(result.err.kind === "lockReleaseFailed");

		expect(result.err.cause.reason).toBe("the lock store was unreachable");
		expect(result.err.kind).toBe("lockReleaseFailed");
	});

	it("should read credentials from the process environment when the caller injects none", async () => {
		expect.assertions(2);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("AWS_ACCESS_KEY_ID", "example-access-key");

		const seen: Array<string | undefined> = [];

		const result = await forceReleaseStateLockAsync({
			config: s3Config(),
			environment: "production",
			plugins: fakeStateBackendPlugins({
				name: "s3",
				createLockPort: (context) => {
					seen.push(context.getEnv("AWS_ACCESS_KEY_ID"));
					return { data: releasingLockPort(undefined).port, success: true };
				},
				createPort: () => ({ data: neverStatePort(), success: true }),
				schema: S3_SCHEMA,
				specifier: "@example/state-s3",
			}),
		});

		assert(result.success);

		expect(seen).toStrictEqual(["example-access-key"]);
		expect(result.data.locking).toBe("exclusive");
	});

	it("should surface a backend name no builtin and no plugin claims", async () => {
		expect.assertions(1);

		const result = await forceReleaseStateLockAsync({
			config: s3Config(),
			environment: "production",
			getEnv: environmentFrom({}),
		});

		assert(!result.success);

		expect(result.err.kind).toBe("unsupportedBackend");
	});

	it("should surface an environment the config declares no state for", async () => {
		expect.assertions(1);

		const result = await forceReleaseStateLockAsync({
			config: { environments: { production: {} } },
			environment: "production",
			getEnv: environmentFrom({}),
		});

		assert(!result.success);

		expect(result.err.kind).toBe("stateNotConfigured");
	});
});
