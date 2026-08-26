import { type BedrockState, serializeStateFile, type StateBackendContext } from "@bedrock-rbx/core";

import process from "node:process";
import { assert, describe, expect, it, onTestFinished } from "vitest";

import { fakeS3 } from "#tests/helpers/fake-s3";
import s3Plugin, { s3StateBackend } from "./plugin.ts";
import type { S3StateConfig } from "./state-schema.ts";

const STATE_CONFIG: S3StateConfig = { bucket: "my-bucket", region: "eu-west-2" };

const PRODUCTION_STATE: BedrockState = { environment: "production", resources: [], version: 1 };

const CREDENTIALS = {
	AWS_ACCESS_KEY_ID: "injected-access-key",
	AWS_SECRET_ACCESS_KEY: "injected-secret",
};

/**
 * Read a variable from a fixed set, the way core hands a **Backend** the
 * environment rather than letting it reach for `process.env`.
 *
 * @param variables - What the environment holds.
 * @returns The reader to hand the builder.
 */
function environmentOf(
	variables: Readonly<Record<string, string>>,
): (name: string) => string | undefined {
	return (name) => variables[name];
}

/**
 * Put the named variables on the process environment for one test, so the
 * standard AWS credential chain has something to resolve, and take them
 * back off once it finishes.
 *
 * @param variables - Environment variables to set for the test.
 */
function withEnvironment(variables: Readonly<Record<string, string>>): void {
	const previous = Object.entries(variables).map(([name]) => [name, process.env[name]] as const);
	onTestFinished(() => {
		for (const [name, value] of previous) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
	});

	for (const [name, value] of Object.entries(variables)) {
		process.env[name] = value;
	}
}

describe("s3 plugin", () => {
	it("should claim the s3 backend name", () => {
		expect.assertions(2);

		expect(s3Plugin.stateBackends).toHaveLength(1);
		expect(s3StateBackend.name).toBe("s3");
	});

	it("should declare the state keys a user configures the bucket with", () => {
		expect.assertions(2);

		expect(s3StateBackend.schema({ bucket: "my-bucket", region: "eu-west-2" })).toStrictEqual(
			STATE_CONFIG,
		);
		expect(s3StateBackend.schema({ region: "eu-west-2" })).not.toStrictEqual(STATE_CONFIG);
	});

	it("should build a port that reads the bucket the state block named", async () => {
		expect.assertions(2);

		const store = fakeS3({ "/production.json": serializeStateFile(PRODUCTION_STATE) });
		const built = s3StateBackend.createPort(
			context({
				fetch: store.fetchFunc,
				getEnv: environmentOf(CREDENTIALS),
				stateConfig: STATE_CONFIG,
			}),
		);

		assert(built.success);

		const read = await built.data.read("production");

		assert(read.success);

		const sent = new URL(store.calls[0]!.url);

		expect(read.data).toStrictEqual(PRODUCTION_STATE);
		expect(sent.hostname).toBe("my-bucket.s3.eu-west-2.amazonaws.com");
	});

	it("should sign with the credentials core's environment holds", async () => {
		expect.assertions(2);

		const store = fakeS3();
		const built = s3StateBackend.createPort(
			context({
				fetch: store.fetchFunc,
				getEnv: environmentOf({
					...CREDENTIALS,
					AWS_SESSION_TOKEN: "injected-session-token",
				}),
				stateConfig: STATE_CONFIG,
			}),
		);

		assert(built.success);

		await built.data.read("production");

		expect(store.calls[0]!.headers["authorization"]).toStartWith(
			"AWS4-HMAC-SHA256 Credential=injected-access-key/",
		);
		expect(store.calls[0]!.headers["x-amz-security-token"]).toBe("injected-session-token");
	});

	it("should fall back to the standard aws chain when the environment names no key", async () => {
		expect.assertions(1);

		const store = fakeS3();
		withEnvironment({
			AWS_ACCESS_KEY_ID: "chain-access-key",
			AWS_SECRET_ACCESS_KEY: "chain-secret",
		});
		const built = s3StateBackend.createPort(
			context({ fetch: store.fetchFunc, stateConfig: STATE_CONFIG }),
		);

		assert(built.success);

		await built.data.read("production");

		expect(store.calls[0]!.headers["authorization"]).toStartWith(
			"AWS4-HMAC-SHA256 Credential=chain-access-key/",
		);
	});

	it("should sign without a session token when the environment names none", async () => {
		expect.assertions(1);

		const store = fakeS3();
		const built = s3StateBackend.createPort(
			context({
				fetch: store.fetchFunc,
				getEnv: environmentOf(CREDENTIALS),
				stateConfig: STATE_CONFIG,
			}),
		);

		assert(built.success);

		await built.data.read("production");

		expect(store.calls[0]!.headers).not.toContainKey("x-amz-security-token");
	});
});

/**
 * Build what core hands the **Backend**'s builder, defaulting the
 * environment to one holding nothing.
 *
 * @param overrides - What the test states about the context.
 * @returns The context to hand the builder.
 */
function context(
	overrides: Partial<StateBackendContext<S3StateConfig>> &
		Pick<StateBackendContext<S3StateConfig>, "stateConfig">,
): StateBackendContext<S3StateConfig> {
	return { getEnv: () => {}, ...overrides };
}
