import {
	createConfigValidator,
	migrateMantleState,
	type PluginRegistry,
	type StateBackendMigrateSource,
} from "@bedrock-rbx/core";

import { assert, describe, expect, it } from "vitest";

import { s3StateBackend } from "#src/plugin";
import { fakeS3 } from "#tests/helpers/fake-s3";

const SPECIFIER = "@bedrock-rbx/state-s3";

const MANTLE_OBJECT = "/pirate-wars.mantle-state.yml";

const MANTLE_STATE = [
	'version: "6"',
	"environments:",
	"  production:",
	"    - id: experience_singleton",
	"      inputs:",
	"        experience:",
	"          groupId: ~",
	"      outputs:",
	"        experience:",
	"          assetId: 6031475575",
	"          startPlaceId: 17613681043",
	"      dependencies: []",
	"",
].join("\n");

const COORDINATES: Readonly<Record<string, string>> = {
	key: "pirate-wars",
	bucket: "mantle-states",
	region: "us-west-2",
};

const ENVIRONMENT: Readonly<Record<string, string>> = {
	AWS_ACCESS_KEY_ID: "migrate-access-key",
	AWS_SECRET_ACCESS_KEY: "migrate-secret",
};

const PLUGINS: PluginRegistry = {
	stateBackends: new Map([["s3", { declaration: s3StateBackend, specifier: SPECIFIER }]]),
};

/**
 * Read what this **Backend** declared about fetching, which is what core
 * drives a migration through.
 *
 * @returns The declared source.
 */
function migrateSource(): StateBackendMigrateSource {
	const source = s3StateBackend.migrateSource;

	assert(source !== undefined);

	return source;
}

/**
 * Whether a `state` block naming this **Backend** is one core accepts,
 * which is what a migration onto it has to emit.
 *
 * @param stateConfig - The `state` keys the migration recorded.
 * @returns `true` when the config validates.
 */
function accepts(stateConfig: Readonly<Record<string, unknown>>): boolean {
	const validate = createConfigValidator(PLUGINS);
	return validate(
		{ environments: { production: {} }, state: { ...stateConfig, backend: "s3" } },
		"bedrock.config.ts",
	).success;
}

describe("migrating through the s3 plugin", () => {
	it("should hand core a mantle state it parses without a local file", async () => {
		expect.assertions(2);

		const store = fakeS3({ [MANTLE_OBJECT]: MANTLE_STATE });

		const fetched = await migrateSource().readBytes({
			coordinates: COORDINATES,
			fetch: store.fetchFunc,
			getEnv: (name) => ENVIRONMENT[name],
		});

		assert(fetched.success);

		const migrated = await migrateMantleState({
			configFormat: "typescript",
			stateFileBytes: fetched.data,
			stateFilePath: ".mantle-state.yml",
		});

		assert(migrated.success);

		const { universe } = migrated.data.config;

		assert(universe !== undefined);

		expect(universe.universeId).toBe("6031475575");
		expect(migrated.data.statesByEnvironment["production"]).toBeDefined();
	});

	it("should translate where mantle kept its state into a config core accepts", () => {
		expect.assertions(2);

		const translate = migrateSource().toStateConfig;

		assert(translate !== undefined);

		expect(accepts(translate(COORDINATES))).toBeTrue();
		expect(
			accepts(translate({ ...COORDINATES, endpoint: "https://account-id.r2.example.com" })),
		).toBeTrue();
	});

	it("should accept the answers a migration onto this backend collects", () => {
		expect.assertions(1);

		expect(accepts({ bucket: "my-bucket", region: "eu-west-2" })).toBeTrue();
	});
});
