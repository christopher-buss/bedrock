import {
	type Config,
	createConfigValidator,
	deploy,
	type DriverRegistry,
	OpenCloudError,
	parseStateFile,
	type PluginRegistry,
} from "@bedrock-rbx/core";

import { assert, describe, expect, it } from "vitest";

import { parseLockRecord } from "#src/lock-record";
import { s3StateBackend } from "#src/plugin";
import { fakeS3 } from "#tests/helpers/fake-s3";

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
