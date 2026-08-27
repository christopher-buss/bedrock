import { type BedrockState, serializeStateFile } from "@bedrock-rbx/core";

import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import { withEnvironment } from "#tests/helpers/environment";
import { fakeS3, fakeS3Failure } from "#tests/helpers/fake-s3";
import type { S3StateAdapterDeps } from "./s3-client.ts";
import { createS3StateAdapter, readObjectTextAsync } from "./s3-state-adapter.ts";

const BUCKET = "my-bucket";
const REGION = "eu-west-2";

const PRODUCTION_STATE: BedrockState = {
	environment: "production",
	resources: [],
	version: 1,
};

/**
 * What the standard AWS credential chain throws when nothing in it
 * resolves a credential.
 */
class CredentialsProviderError extends Error {
	public override readonly name = "CredentialsProviderError";

	constructor() {
		super("Could not load credentials from any providers");
	}
}

const CREDENTIALS = { accessKeyId: "example-access-key", secretAccessKey: "example-secret" };

/**
 * Build the adapter against a fake store, with the credentials a test
 * signs with supplied so signing is exercised without reaching for the
 * ambient AWS environment.
 *
 * @param deps - What the test configures beyond bucket and region.
 * @returns The adapter under test.
 */
function adapterFor(deps: Partial<S3StateAdapterDeps> & Pick<S3StateAdapterDeps, "fetch">) {
	return createS3StateAdapter({
		bucket: BUCKET,
		credentials: CREDENTIALS,
		region: REGION,
		...deps,
	});
}

describe(createS3StateAdapter, () => {
	describe("read", () => {
		it("should yield no state when the environment has never been deployed", async () => {
			expect.assertions(2);

			const store = fakeS3();

			const result = await adapterFor({ fetch: store.fetchFunc }).read("production");

			assert(result.success);

			expect(result.data).toBeUndefined();
			expect(store.calls[0]!.method).toBe("GET");
		});

		it("should read back the state a previous deploy wrote", async () => {
			expect.assertions(2);

			const store = fakeS3({ "/production.json": serializeStateFile(PRODUCTION_STATE) });

			const result = await adapterFor({ fetch: store.fetchFunc }).read("production");

			assert(result.success);
			assert(result.data !== undefined);

			expect(result.data.environment).toBe("production");
			expect(result.data.version).toBe(1);
		});

		it("should fail rather than collapse to empty state when the object is corrupt", async () => {
			expect.assertions(2);

			const store = fakeS3({ "/production.json": "{ not json" });

			const result = await adapterFor({ fetch: store.fetchFunc }).read("production");

			assert(!result.success);

			expect(result.err.kind).toBe("stateError");
			expect(result.err.file).toBe("s3://my-bucket/production.json");
		});

		it("should read one object per environment under the configured prefix", async () => {
			expect.assertions(2);

			const store = fakeS3();
			const port = adapterFor({ fetch: store.fetchFunc, prefix: "bedrock/state" });

			await port.read("production");
			await port.read("staging");

			const [first, second] = store.calls.map((call) => new URL(call.url));

			expect(first!.pathname).toBe("/bedrock/state/production.json");
			expect(second!.pathname).toBe("/bedrock/state/staging.json");
		});

		it("should sign the request it sends to the bucket", async () => {
			expect.assertions(2);

			const store = fakeS3();

			await adapterFor({ fetch: store.fetchFunc }).read("production");

			expect(store.calls[0]!.headers["authorization"]).toStartWith(
				"AWS4-HMAC-SHA256 Credential=example-access-key/",
			);
			expect(store.calls[0]!.headers["authorization"]).toInclude(
				`/${REGION}/s3/aws4_request`,
			);
		});

		it("should refuse an environment name that would escape the object layout", async () => {
			expect.assertions(2);

			const store = fakeS3();

			const result = await adapterFor({ fetch: store.fetchFunc }).read("../other");

			assert(!result.success);

			expect(result.err.kind).toBe("stateError");
			expect(store.calls).toBeEmpty();
		});
	});

	describe("write", () => {
		it("should store the state at the environment's own object", async () => {
			expect.assertions(3);

			const store = fakeS3();

			const result = await adapterFor({
				fetch: store.fetchFunc,
				prefix: "bedrock",
			}).write(PRODUCTION_STATE);

			assert(result.success);

			expect(store.calls[0]!.method).toBe("PUT");
			expect(store.calls[0]!.headers["content-type"]).toBe("application/json");
			expect(store.objects.get("/bedrock/production.json")).toBe(
				serializeStateFile(PRODUCTION_STATE),
			);
		});

		it("should read back the state it just wrote", async () => {
			expect.assertions(1);

			const store = fakeS3();
			const port = adapterFor({ fetch: store.fetchFunc });

			await port.write(PRODUCTION_STATE);
			const result = await port.read("production");

			assert(result.success);

			expect(result.data).toStrictEqual(PRODUCTION_STATE);
		});

		it("should leave every other environment's object untouched", async () => {
			expect.assertions(1);

			const store = fakeS3({ "/staging.json": serializeStateFile(PRODUCTION_STATE) });

			await adapterFor({ fetch: store.fetchFunc }).write(PRODUCTION_STATE);

			expect([...store.objects.keys()]).toStrictEqual(["/staging.json", "/production.json"]);
		});

		it("should refuse an environment name that would escape the object layout", async () => {
			expect.assertions(2);

			const store = fakeS3();

			const result = await adapterFor({ fetch: store.fetchFunc }).write({
				...PRODUCTION_STATE,
				environment: "../other",
			});

			assert(!result.success);

			expect(result.err.kind).toBe("stateError");
			expect(store.calls).toBeEmpty();
		});
	});

	describe("client configuration", () => {
		it("should sign with credentials from the standard aws chain when none are supplied", async () => {
			expect.assertions(1);

			const store = fakeS3();
			withEnvironment({
				AWS_ACCESS_KEY_ID: "chain-access-key",
				AWS_SECRET_ACCESS_KEY: "chain-secret",
			});

			await createS3StateAdapter({
				bucket: BUCKET,
				fetch: store.fetchFunc,
				region: REGION,
			}).read("production");

			expect(store.calls[0]!.headers["authorization"]).toStartWith(
				"AWS4-HMAC-SHA256 Credential=chain-access-key/",
			);
		});

		it("should send through the runtime's own fetch when no transport is injected", async () => {
			expect.assertions(1);

			const store = fakeS3();
			vi.stubGlobal("fetch", store.fetchFunc);
			onTestFinished(() => {
				vi.unstubAllGlobals();
			});

			await createS3StateAdapter({
				bucket: BUCKET,
				credentials: CREDENTIALS,
				region: REGION,
			}).read("production");

			expect(store.calls).toHaveLength(1);
		});

		it("should address the bucket as a subdomain by default", async () => {
			expect.assertions(1);

			const store = fakeS3();

			await adapterFor({ fetch: store.fetchFunc }).read("production");

			const sent = new URL(store.calls[0]!.url);

			expect(sent.hostname).toBe("my-bucket.s3.eu-west-2.amazonaws.com");
		});

		it("should address the bucket as a path segment when path style is forced", async () => {
			expect.assertions(2);

			const store = fakeS3();

			await adapterFor({ fetch: store.fetchFunc, forcePathStyle: true }).read("production");

			const sent = new URL(store.calls[0]!.url);

			expect(sent.hostname).toBe("s3.eu-west-2.amazonaws.com");
			expect(sent.pathname).toBe("/my-bucket/production.json");
		});

		it("should address a configured endpoint instead of aws", async () => {
			expect.assertions(1);

			const store = fakeS3();

			await adapterFor({
				endpoint: "http://localhost:9000",
				fetch: store.fetchFunc,
				forcePathStyle: true,
			}).read("production");

			expect(store.calls[0]!.url).toStartWith("http://localhost:9000/my-bucket/");
		});

		it("should send a checksum with a write by default", async () => {
			expect.assertions(1);

			const store = fakeS3();

			await adapterFor({ fetch: store.fetchFunc }).write(PRODUCTION_STATE);

			expect(store.calls[0]!.headers).toContainKey("x-amz-checksum-crc32");
		});

		it("should send no checksum with a write when checksums are calculated only where required", async () => {
			expect.assertions(1);

			const store = fakeS3();

			await adapterFor({
				checksumCalculation: "whenRequired",
				fetch: store.fetchFunc,
			}).write(PRODUCTION_STATE);

			expect(store.calls[0]!.headers).not.toContainKey("x-amz-checksum-crc32");
		});
	});

	describe("failures", () => {
		it("should report a credential the store refused as access denied", async () => {
			expect.assertions(2);

			const store = fakeS3Failure("AccessDenied", 403);

			const result = await adapterFor({ fetch: store.fetchFunc }).read("production");

			assert(!result.success);

			expect(result.err.kind).toBe("stateAccessDenied");
			expect(result.err.reason).toInclude("AccessDenied");
		});

		it("should report a bucket that does not resolve as state not found", async () => {
			expect.assertions(1);

			const store = fakeS3Failure("NoSuchBucket", 404);

			const result = await adapterFor({ fetch: store.fetchFunc }).read("production");

			assert(!result.success);

			expect(result.err.kind).toBe("stateNotFound");
		});

		it("should report no credential resolving as its own failure, not as access denied", async () => {
			expect.assertions(3);

			const store = fakeS3();

			const result = await adapterFor({
				credentials: async () => {
					throw new CredentialsProviderError();
				},
				fetch: store.fetchFunc,
			}).read("production");

			assert(!result.success);
			assert(result.err.kind === "pluginStateBackend");

			expect(result.err.specifier).toBe("@bedrock-rbx/state-s3");
			expect(result.err.detail).toMatchObject({ kind: "missingCredentials" });
			expect(store.calls).toBeEmpty();
		});

		it("should carry what the store reported on a refusal it cannot read", async () => {
			expect.assertions(2);

			const store = fakeS3Failure("InvalidBucketState", 409);

			const result = await adapterFor({ fetch: store.fetchFunc }).write(PRODUCTION_STATE);

			assert(!result.success);
			assert(result.err.kind === "pluginStateBackend");

			expect(result.err.detail).toMatchObject({
				name: "InvalidBucketState",
				kind: "requestFailed",
				statusCode: 409,
			});
			expect(result.err.file).toBe("s3://my-bucket/production.json");
		});
	});
});

describe(readObjectTextAsync, () => {
	it("should read a body the store never sent as an empty object, not as absent state", async () => {
		expect.assertions(2);

		await expect(readObjectTextAsync(undefined)).resolves.toBe("");
		await expect(
			readObjectTextAsync({ transformToString: async () => '{"stored":true}' }),
		).resolves.toBe('{"stored":true}');
	});
});
