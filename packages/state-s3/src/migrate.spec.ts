import type { StateBackendMigrateSource } from "@bedrock-rbx/core";

import { assert, describe, expect, it } from "vitest";

import { withEnvironment } from "#tests/helpers/environment";
import { fakeS3 } from "#tests/helpers/fake-s3";
import { s3MigrateSource } from "./migrate.ts";

const MANTLE_STATE = ["version: '6'", "environments: {}", ""].join("\n");

const DECODER = new TextDecoder();

const MANTLE_OBJECT_PATH = "/pirate-wars.mantle-state.yml";

const COORDINATES: Readonly<Record<string, string>> = {
	key: "pirate-wars",
	bucket: "mantle-states",
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

		const fetched = await s3MigrateSource.readBytes({
			coordinates: COORDINATES,
			fetch: store.fetchFunc,
			getEnv: environmentOf(CREDENTIALS),
		});

		assert(fetched.success);

		expect(DECODER.decode(fetched.data)).toBe(MANTLE_STATE);
		expect(hostAddressed(store.calls[0]!.url)).toBe("mantle-states.s3.us-west-2.amazonaws.com");
	});

	it("should read the same object when the user names it as mantle stored it", async () => {
		expect.assertions(1);

		const store = fakeS3({ [MANTLE_OBJECT_PATH]: MANTLE_STATE });

		const fetched = await s3MigrateSource.readBytes({
			coordinates: { ...COORDINATES, key: "pirate-wars.mantle-state.yml" },
			fetch: store.fetchFunc,
			getEnv: environmentOf(CREDENTIALS),
		});

		assert(fetched.success);

		expect(DECODER.decode(fetched.data)).toBe(MANTLE_STATE);
	});

	it("should sign with the credentials core's environment holds", async () => {
		expect.assertions(1);

		const store = fakeS3({ [MANTLE_OBJECT_PATH]: MANTLE_STATE });

		await s3MigrateSource.readBytes({
			coordinates: COORDINATES,
			fetch: store.fetchFunc,
			getEnv: environmentOf(CREDENTIALS),
		});

		expect(store.calls[0]!.headers["authorization"]).toStartWith(
			"AWS4-HMAC-SHA256 Credential=injected-access-key/",
		);
	});

	it("should fall back to the standard aws chain when the environment names no key", async () => {
		expect.assertions(1);

		const store = fakeS3({ [MANTLE_OBJECT_PATH]: MANTLE_STATE });
		withEnvironment({
			AWS_ACCESS_KEY_ID: "chain-access-key",
			AWS_SECRET_ACCESS_KEY: "chain-secret",
		});

		await s3MigrateSource.readBytes({
			coordinates: COORDINATES,
			fetch: store.fetchFunc,
			getEnv: () => {},
		});

		expect(store.calls[0]!.headers["authorization"]).toStartWith(
			"AWS4-HMAC-SHA256 Credential=chain-access-key/",
		);
	});

	it("should address the endpoint mantle's custom region form names", async () => {
		expect.assertions(1);

		const store = fakeS3({ [MANTLE_OBJECT_PATH]: MANTLE_STATE });

		await s3MigrateSource.readBytes({
			coordinates: {
				...COORDINATES,
				endpoint: "https://account-id.r2.example.com",
				region: "auto",
			},
			fetch: store.fetchFunc,
			getEnv: environmentOf(CREDENTIALS),
		});

		expect(hostAddressed(store.calls[0]!.url)).toBe("mantle-states.account-id.r2.example.com");
	});

	it("should refuse with the object named when the bucket holds no state there", async () => {
		expect.assertions(2);

		const store = fakeS3();

		const fetched = await s3MigrateSource.readBytes({
			coordinates: COORDINATES,
			fetch: store.fetchFunc,
			getEnv: environmentOf(CREDENTIALS),
		});

		assert(!fetched.success);

		expect(fetched.err.reason).toStartWith("s3://mantle-states/pirate-wars.mantle-state.yml");
		expect(fetched.err.detail).toMatchObject({ name: "NoSuchKey", kind: "missingObject" });
	});

	it("should refuse coordinates that name no bucket rather than address one", async () => {
		expect.assertions(2);

		const store = fakeS3();

		const fetched = await s3MigrateSource.readBytes({
			coordinates: { key: "pirate-wars", region: "us-west-2" },
			fetch: store.fetchFunc,
			getEnv: environmentOf(CREDENTIALS),
		});

		assert(!fetched.success);

		expect(fetched.err.reason).toStartWith("the Mantle state coordinates are incomplete:");
		expect(store.calls).toBeEmpty();
	});
});

/**
 * Read the host one recorded request addressed.
 *
 * @param url - The absolute URL the client addressed.
 * @returns The host the request went to.
 */
function hostAddressed(url: string): string {
	const addressed = new URL(url);
	return addressed.hostname;
}

/**
 * Read the translation this **Backend** declared, which is what core calls
 * with the coordinates the state was fetched from.
 *
 * @returns The declared translation.
 */
function translation(): NonNullable<StateBackendMigrateSource["toStateConfig"]> {
	const translate = s3MigrateSource.toStateConfig;

	assert(translate !== undefined);

	return translate;
}

describe("translating mantle's remote state into a state block", () => {
	it("should keep the project's state under the name mantle keyed it by", () => {
		expect.assertions(2);

		const translate = translation();
		const translated = translate(COORDINATES);

		expect(translated).toStrictEqual({
			bucket: "mantle-states",
			prefix: "pirate-wars",
			region: "us-west-2",
		});
		expect(translate({ ...COORDINATES, key: "pirate-wars.mantle-state.yml" })).toStrictEqual(
			translated,
		);
	});

	it("should carry the endpoint mantle's custom region form names", () => {
		expect.assertions(1);

		expect(
			translation()({
				...COORDINATES,
				endpoint: "https://account-id.r2.example.com",
				region: "auto",
			}),
		).toStrictEqual({
			bucket: "mantle-states",
			endpoint: "https://account-id.r2.example.com",
			prefix: "pirate-wars",
			region: "auto",
		});
	});

	it("should refuse coordinates no state could have been fetched from", () => {
		expect.assertions(1);

		expect(() => translation()({ key: "pirate-wars" })).toThrowWithMessage(
			TypeError,
			/^the Mantle state coordinates are incomplete:/,
		);
	});
});
