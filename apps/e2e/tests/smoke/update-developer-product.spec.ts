import {
	asRobloxAssetId,
	type Config,
	createDeveloperProductDriver,
	createGistStateAdapter,
	deploy,
	type DriverRegistry,
	loadConfig,
	type ResourceDriver,
	type ResourceKind,
} from "@bedrock-rbx/core";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

import { pruneStateGist } from "../helpers/prune-state-gist.ts";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "developer-product");

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID_ENV = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const TOKEN = process.env["GITHUB_TOKEN"];
const GIST_ID = process.env["BEDROCK_TEST_GIST_ID"];

const HAS_SECRETS =
	API_KEY !== undefined &&
	UNIVERSE_ID_ENV !== undefined &&
	TOKEN !== undefined &&
	GIST_ID !== undefined;

// All runs share one developer product via the gist's persistent state.
// Open Cloud v2 has no DELETE for developer products, so reusing the stored
// productId is the only way to keep the leak bounded.
const STABLE_ENVIRONMENT = "developer-product-smoke";

function unreachableDriver<K extends ResourceKind>(label: string): ResourceDriver<K> {
	return {
		async create() {
			throw new Error(`unreachable: smoke config declares no ${label}`);
		},
	};
}

async function fixtureReadFile(path: string): Promise<Uint8Array> {
	return readFile(join(FIXTURE_DIR, path));
}

function withEnvironment<T extends Config>(base: T, environment: string): T {
	// Spreading a discriminated-union Config widens the result past either
	// arm; the cast keeps the input arm we know is preserved structurally.
	return {
		...base,
		environments: { ...base.environments, [environment]: {} },
	} as T;
}

function withMutatedProduct(
	base: Config,
	overrides: { description: string; name: string },
): Config {
	const products = base.products ?? {};
	const existing = products["smoke-product"];
	assert(existing !== undefined, "fixture config must declare a smoke-product entry");
	return {
		...base,
		products: {
			...products,
			"smoke-product": { ...existing, ...overrides },
		},
	};
}

describe("developer-product update via real Roblox", () => {
	it.skipIf(!HAS_SECRETS)(
		"should update an existing developer product via deploy and persist outputs to a real gist",
		async () => {
			expect.assertions(5);

			assert(API_KEY !== undefined, "BEDROCK_API_KEY must be set");
			assert(UNIVERSE_ID_ENV !== undefined, "ROBLOX_TEST_UNIVERSE_ID must be set");
			assert(TOKEN !== undefined, "GITHUB_TOKEN must be set");
			assert(GIST_ID !== undefined, "BEDROCK_TEST_GIST_ID must be set");

			const universeId = asRobloxAssetId(UNIVERSE_ID_ENV);
			const statePort = createGistStateAdapter({ gistId: GIST_ID, token: TOKEN });

			const loaded = await loadConfig({ cwd: FIXTURE_DIR });
			assert(
				loaded.success,
				`loadConfig failed: ${JSON.stringify(loaded.success ? null : loaded.err)}`,
			);
			const baseConfig = loaded.data;

			const developerProductDriver = createDeveloperProductDriver({
				client: new DeveloperProductsClient({ apiKey: API_KEY }),
				readFile: fixtureReadFile,
				universeId,
			});

			const registry = {
				developerProduct: developerProductDriver,
				gamePass: unreachableDriver("game passes"),
				place: unreachableDriver("places"),
				universe: unreachableDriver("universe block"),
			} satisfies DriverRegistry;

			const bootstrapConfig = withEnvironment(baseConfig, STABLE_ENVIRONMENT);

			try {
				// The bootstrap deploy reconciles the product against the
				// fixture baseline, creating on the first run and reverting any
				// drift from a prior update otherwise. The update deploy then
				// mutates name and description with a per-run timestamp.
				const bootstrap = await deploy({
					config: bootstrapConfig,
					environment: STABLE_ENVIRONMENT,
					readFile: fixtureReadFile,
					registry,
					statePort,
				});
				assert(
					bootstrap.success,
					`bootstrap deploy failed: ${JSON.stringify(bootstrap.success ? null : bootstrap.err)}`,
				);

				const stamp = String(Date.now());
				const updatedConfig = withMutatedProduct(bootstrapConfig, {
					name: `Smoke Test Product ${stamp}`,
					description: `smoke description ${stamp}`,
				});
				const updated = await deploy({
					config: updatedConfig,
					environment: STABLE_ENVIRONMENT,
					readFile: fixtureReadFile,
					registry,
					statePort,
				});
				assert(
					updated.success,
					`update deploy failed: ${JSON.stringify(updated.success ? null : updated.err)}`,
				);

				const persistedRead = await statePort.read(STABLE_ENVIRONMENT);
				assert(
					persistedRead.success,
					`state read failed: ${JSON.stringify(persistedRead.success ? null : persistedRead.err)}`,
				);

				const persisted = persistedRead.data;
				assert(persisted !== undefined);

				expect(persisted.environment).toBe(STABLE_ENVIRONMENT);
				expect(persisted.resources).toHaveLength(1);

				const resource = persisted.resources[0];
				assert(resource !== undefined);
				assert(resource.kind === "developerProduct");

				expect(resource.name).toBe(`Smoke Test Product ${stamp}`);
				expect(resource.description).toBe(`smoke description ${stamp}`);
				expect(resource.outputs.productId).toBeString();
			} finally {
				await pruneStateGist({
					filenamePrefix: `state.${STABLE_ENVIRONMENT}-`,
					gistId: GIST_ID,
					keep: 0,
					token: TOKEN,
				});
			}
		},
		60_000,
	);
});
