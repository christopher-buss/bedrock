import {
	asRobloxAssetId,
	type Config,
	createGamePassDriver,
	createGistStateAdapter,
	deploy,
	type DriverRegistry,
	loadConfig,
	type ResourceDriver,
	type ResourceKind,
} from "@bedrock-rbx/core";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

import { pruneStateGist } from "../helpers/prune-state-gist.ts";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "game-pass");

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID_ENV = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const TOKEN = process.env["GITHUB_TOKEN"];
const GIST_ID = process.env["BEDROCK_TEST_GIST_ID"];

const HAS_SECRETS =
	API_KEY !== undefined &&
	UNIVERSE_ID_ENV !== undefined &&
	TOKEN !== undefined &&
	GIST_ID !== undefined;

// All runs share one game pass via the gist's persistent state. Open Cloud
// v2 has no DELETE for game passes and caps creation at 5/day per universe,
// so reusing the stored assetId is required to stay within quota.
const STABLE_ENVIRONMENT = "game-pass-smoke";

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

function withMutatedPass(base: Config, overrides: { description: string; name: string }): Config {
	const passes = base.passes ?? {};
	const existing = passes["smoke-pass"];
	assert(existing !== undefined, "fixture config must declare a smoke-pass entry");
	return {
		...base,
		passes: {
			...passes,
			"smoke-pass": { ...existing, ...overrides },
		},
	};
}

describe("game-pass update via real Roblox", () => {
	it.skipIf(!HAS_SECRETS)(
		"should update an existing game pass via deploy and persist outputs to a real gist",
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

			const gamePassDriver = createGamePassDriver({
				client: new GamePassesClient({ apiKey: API_KEY }),
				readFile: fixtureReadFile,
				universeId,
			});

			const registry = {
				developerProduct: unreachableDriver("developer products"),
				gamePass: gamePassDriver,
				place: unreachableDriver("places"),
				universe: unreachableDriver("universe block"),
			} satisfies DriverRegistry;

			const bootstrapConfig = withEnvironment(baseConfig, STABLE_ENVIRONMENT);

			try {
				// The bootstrap deploy creates the pass when the gist holds no
				// matching state and is a planned noop otherwise. The update
				// deploy exercises the id round-trip on a mutation.
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
				const updatedConfig = withMutatedPass(bootstrapConfig, {
					name: `Smoke Test Pass ${stamp}`,
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
				assert(resource.kind === "gamePass");

				expect(resource.name).toBe(`Smoke Test Pass ${stamp}`);
				expect(resource.description).toBe(`smoke description ${stamp}`);
				expect(resource.outputs.assetId).toBeString();
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
