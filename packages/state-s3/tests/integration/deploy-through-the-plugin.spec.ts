import {
	type BedrockState,
	type Config,
	createConfigValidator,
	deploy,
	type DriverRegistry,
	OpenCloudError,
	parseStateFile,
	type PluginRegistry,
	serializeStateFile,
	type StateBackendFetch,
} from "@bedrock-rbx/core";

import { assert, describe, expect, it } from "vitest";

import { parseLockRecord } from "#src/lock-record";
import { s3StateBackend } from "#src/plugin";
import { type FakeS3, fakeS3 } from "#tests/helpers/fake-s3";

const SPECIFIER = "@bedrock-rbx/state-s3";

const STATE_OBJECT = "/bedrock/production.json";
const LOCK_OBJECT = "/bedrock/locks/production.json";

const CONFIG: Config = {
	environments: { production: {} },
	state: { backend: "s3", bucket: "my-bucket", prefix: "bedrock", region: "eu-west-2" },
};

const ENVIRONMENT: Readonly<Record<string, string>> = {
	AWS_ACCESS_KEY_ID: "deploy-access-key",
	AWS_SECRET_ACCESS_KEY: "deploy-secret",
};

const PLUGINS: PluginRegistry = {
	stateBackends: new Map([["s3", { declaration: s3StateBackend, specifier: SPECIFIER }]]),
};

/**
 * A registry whose drivers refuse to run, because an **Environment**
 * declaring no resources never reaches one.
 *
 * @returns The registry to hand the **Deploy**.
 */
function refusingRegistry(): DriverRegistry {
	async function refuseAsync(): Promise<{ err: OpenCloudError; success: false }> {
		return { err: new OpenCloudError("no resource is declared here"), success: false };
	}

	return {
		developerProduct: { create: refuseAsync },
		gamePass: { create: refuseAsync },
		place: { create: refuseAsync },
		universe: { create: refuseAsync },
	};
}

/**
 * Wrap a store so another run takes the **Environment** over the moment
 * this deploy has read the **State** it is about to write past, which is
 * what a hold whose **Lease** ran out leaves open.
 *
 * @param store - The store the requests are served from.
 * @param theirs - The **State** that run records.
 * @returns The transport to hand the **Deploy**.
 */
function takenOverAfterRead(store: FakeS3, theirs: BedrockState): StateBackendFetch {
	return async (input, init) => {
		const request = new Request(input, init);
		const { pathname } = new URL(request.url);
		const response = await store.fetchFunc(input, init);
		if (pathname === STATE_OBJECT && request.method !== "PUT") {
			store.put(STATE_OBJECT, serializeStateFile(theirs));
		}

		return response;
	};
}

describe("deploying through the s3 plugin", () => {
	it("should accept a state block carrying the backend's own keys", () => {
		expect.assertions(1);

		const validate = createConfigValidator(PLUGINS);

		expect(validate(CONFIG, "bedrock.config.ts").success).toBeTrue();
	});

	it("should reject a state key the backend never declared", () => {
		expect.assertions(1);

		const validate = createConfigValidator(PLUGINS);

		const result = validate(
			{
				environments: { production: {} },
				state: { backend: "s3", bucket: "my-bucket", zone: "eu-west-2" },
			},
			"bedrock.config.ts",
		);

		expect(result.success).toBeFalse();
	});

	it("should write the deployed state into the bucket", async () => {
		expect.assertions(2);

		const store = fakeS3();

		const result = await deploy({
			config: CONFIG,
			environment: "production",
			fetch: store.fetchFunc,
			getEnv: (name) => ENVIRONMENT[name],
			plugins: PLUGINS,
			registry: refusingRegistry(),
		});

		assert(result.success);

		const stored = store.objects.get("/bedrock/production.json");
		assert(stored !== undefined);

		const parsed = parseStateFile(stored, "s3://my-bucket/bedrock/production.json");

		assert(parsed.success);

		expect(parsed.data!.environment).toBe("production");
		expect(parsed.data!.version).toBe(1);
	});

	it("should read the state a previous deploy left in the bucket", async () => {
		expect.assertions(2);

		const store = fakeS3();
		const options = {
			config: CONFIG,
			environment: "production",
			fetch: store.fetchFunc,
			getEnv: (name: string) => ENVIRONMENT[name],
			plugins: PLUGINS,
			registry: refusingRegistry(),
		};

		await deploy(options);
		store.calls.length = 0;
		const second = await deploy(options);

		assert(second.success);

		const stateCalls = store.calls.filter((call) => call.url.includes(STATE_OBJECT));

		expect(stateCalls[0]!.method).toBe("GET");
		expect(stateCalls[0]!.url).toEndWith(`${STATE_OBJECT}?x-id=GetObject`);
	});

	it("should refuse the state write of a run whose hold was taken over", async () => {
		expect.assertions(3);

		const store = fakeS3();
		const theirs: BedrockState = {
			environment: "production",
			resources: [],
			version: 1,
		};

		const result = await deploy({
			config: CONFIG,
			environment: "production",
			fetch: takenOverAfterRead(store, theirs),
			getEnv: (name) => ENVIRONMENT[name],
			plugins: PLUGINS,
			registry: refusingRegistry(),
		});

		assert(!result.success);

		assert(result.err.kind === "stateWriteFailed");

		expect(result.err.cause.kind).toBe("stateConflict");
		expect(result.err.unsavedState.environment).toBe("production");
		expect(store.objects.get(STATE_OBJECT)).toBe(serializeStateFile(theirs));
	});

	it("should hold the environment across the deploy and give it up afterwards", async () => {
		expect.assertions(3);

		const store = fakeS3();

		const result = await deploy({
			config: CONFIG,
			environment: "production",
			fetch: store.fetchFunc,
			getEnv: (name) => ENVIRONMENT[name],
			plugins: PLUGINS,
			registry: refusingRegistry(),
		});

		assert(result.success);

		const held = store.objects.get(LOCK_OBJECT);
		assert(held !== undefined);

		const record = parseLockRecord(held);
		assert(record !== undefined);

		expect(store.calls[0]!.url).toEndWith(`${LOCK_OBJECT}?x-id=PutObject`);
		expect(record.operation).toBe("deploy");
		expect(record.releasedAt).toBeString();
	});
});
