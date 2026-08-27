import { assert, describe, expect, it } from "vitest";

import { withEnvironment } from "#tests/helpers/environment";
import { fakeS3, stubGlobalFetch } from "#tests/helpers/fake-s3";
import { s3MigrateSource } from "./migrate.ts";

const MANTLE_STATE = ["version: '6'", "environments: {}", ""].join("\n");

const MANTLE_OBJECT_PATH = "/pirate-wars.mantle-state.yml";

const COORDINATES: Readonly<Record<string, string>> = {
	bucket: "mantle-states",
	key: "pirate-wars",
	region: "us-west-2",
};

const CREDENTIALS: Readonly<Record<string, string>> = {
	AWS_ACCESS_KEY_ID: "injected-access-key",
	AWS_SECRET_ACCESS_KEY: "injected-secret",
};

/**
 * Read a variable from a fixed set, the way core hands a **Backend** the
 * environment rather than letting it reach for `process.env`.
 *
 * @param variables - What the environment holds.
 * @returns The reader to hand the source.
 */
function environmentOf(
	variables: Readonly<Record<string, string>>,
): (name: string) => string | undefined {
	return (name) => variables[name];
}

describe("reading the mantle state a bucket holds", () => {
	it("should read the object mantle names after the project", async () => {
		expect.assertions(2);

		const store = fakeS3({ [MANTLE_OBJECT_PATH]: MANTLE_STATE });
		stubGlobalFetch(store.fetchFunc);

		const fetched = await s3MigrateSource.readBytes({
			coordinates: COORDINATES,
			getEnv: environmentOf(CREDENTIALS),
		});

		assert(fetched.success);

		expect(new TextDecoder().decode(fetched.data)).toBe(MANTLE_STATE);
		expect(new URL(store.calls[0]!.url).hostname).toBe(
			"mantle-states.s3.us-west-2.amazonaws.com",
		);
	});

	it("should read the same object when the user names it as mantle stored it", async () => {
		expect.assertions(1);

		const store = fakeS3({ [MANTLE_OBJECT_PATH]: MANTLE_STATE });
		stubGlobalFetch(store.fetchFunc);

		const fetched = await s3MigrateSource.readBytes({
			coordinates: { ...COORDINATES, key: "pirate-wars.mantle-state.yml" },
			getEnv: environmentOf(CREDENTIALS),
		});

		assert(fetched.success);

		expect(new TextDecoder().decode(fetched.data)).toBe(MANTLE_STATE);
	});

	it("should sign with the credentials core's environment holds", async () => {
		expect.assertions(1);

		const store = fakeS3({ [MANTLE_OBJECT_PATH]: MANTLE_STATE });
		stubGlobalFetch(store.fetchFunc);

		await s3MigrateSource.readBytes({
			coordinates: COORDINATES,
			getEnv: environmentOf(CREDENTIALS),
		});

		expect(store.calls[0]!.headers["authorization"]).toStartWith(
			"AWS4-HMAC-SHA256 Credential=injected-access-key/",
		);
	});

	it("should fall back to the standard aws chain when the environment names no key", async () => {
		expect.assertions(1);

		const store = fakeS3({ [MANTLE_OBJECT_PATH]: MANTLE_STATE });
		stubGlobalFetch(store.fetchFunc);
		withEnvironment({
			AWS_ACCESS_KEY_ID: "chain-access-key",
			AWS_SECRET_ACCESS_KEY: "chain-secret",
		});

		await s3MigrateSource.readBytes({ coordinates: COORDINATES, getEnv: () => undefined });

		expect(store.calls[0]!.headers["authorization"]).toStartWith(
			"AWS4-HMAC-SHA256 Credential=chain-access-key/",
		);
	});

	it("should address the endpoint mantle's custom region form names", async () => {
		expect.assertions(1);

		const store = fakeS3({ [MANTLE_OBJECT_PATH]: MANTLE_STATE });
		stubGlobalFetch(store.fetchFunc);

		await s3MigrateSource.readBytes({
			coordinates: {
				...COORDINATES,
				endpoint: "https://account-id.r2.cloudflarestorage.com",
				region: "auto",
			},
			getEnv: environmentOf(CREDENTIALS),
		});

		expect(new URL(store.calls[0]!.url).hostname).toBe(
			"mantle-states.account-id.r2.cloudflarestorage.com",
		);
	});

	it("should refuse with the object named when the bucket holds no state there", async () => {
		expect.assertions(2);

		const store = fakeS3();
		stubGlobalFetch(store.fetchFunc);

		const fetched = await s3MigrateSource.readBytes({
			coordinates: COORDINATES,
			getEnv: environmentOf(CREDENTIALS),
		});

		assert(!fetched.success);

		expect(fetched.err.reason).toStartWith("s3://mantle-states/pirate-wars.mantle-state.yml");
		expect(fetched.err.detail).toMatchObject({ kind: "missingObject", name: "NoSuchKey" });
	});

	it("should refuse coordinates that name no bucket rather than address one", async () => {
		expect.assertions(2);

		const store = fakeS3();
		stubGlobalFetch(store.fetchFunc);

		const fetched = await s3MigrateSource.readBytes({
			coordinates: { key: "pirate-wars", region: "us-west-2" },
			getEnv: environmentOf(CREDENTIALS),
		});

		assert(!fetched.success);

		expect(fetched.err.reason).toStartWith("the Mantle state coordinates are incomplete:");
		expect(store.calls).toBeEmpty();
	});
});
