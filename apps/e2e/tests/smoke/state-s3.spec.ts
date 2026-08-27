import {
	deploy,
	type DriverRegistry,
	loadProjectAsync,
	OpenCloudError,
	parseStateFile,
} from "@bedrock-rbx/core";

import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";

import { assertOk } from "../helpers/assert-ok.ts";
import {
	deleteS3ObjectAsync,
	headS3ObjectAsync,
	readS3ObjectTextAsync,
} from "../helpers/s3-object.ts";
import { BUCKET, ENVIRONMENT, PREFIX, REGION } from "./fixtures/state-s3/coordinates.ts";

// Unset, the AWS default provider queries EC2 instance metadata, which on a
// runner outside AWS only fails after a wait.
const HAS_SECRETS = process.env["AWS_ACCESS_KEY_ID"] !== undefined;

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "state-s3");

const KEY = `${PREFIX}/${ENVIRONMENT}.json`;
const OBJECT = { key: KEY, bucket: BUCKET, region: REGION };

/**
 * A registry whose drivers all refuse. A deploy that succeeds against it
 * touched nothing but the bucket.
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

describe("s3 state backend against real aws", () => {
	it.skipIf(!HAS_SECRETS)(
		"should deploy through a config naming the plugin and leave state in the bucket",
		async () => {
			expect.assertions(3);

			// Start from an empty key: this covers a first deploy into a
			// bucket holding no state for this environment.
			await deleteS3ObjectAsync(OBJECT);
			onTestFinished(async () => {
				await deleteS3ObjectAsync(OBJECT);
			});

			const loaded = await loadProjectAsync({ cwd: FIXTURE });
			assertOk(loaded, "loadProjectAsync");

			expect(loaded.data.plugins.stateBackends.has("s3")).toBeTrue();

			const result = await deploy({
				config: loaded.data.config,
				environment: ENVIRONMENT,
				plugins: loaded.data.plugins,
				registry: refusingRegistry(),
			});
			assertOk(result, "deploy");

			const head = await headS3ObjectAsync(OBJECT);

			expect(head.ContentType).toBe("application/json");

			const parsed = parseStateFile(await readS3ObjectTextAsync(OBJECT), KEY);
			assertOk(parsed, "parseStateFile");

			expect(parsed.data).toStrictEqual({
				environment: ENVIRONMENT,
				resources: [],
				version: 1,
			});
		},
		60_000,
	);
});
