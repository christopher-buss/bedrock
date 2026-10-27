import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import { createFakeHttpClient } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import {
	asResourceKey,
	asRobloxAssetId,
	type BedrockState,
	buildDesired,
	type Config,
	createGamePassDriver,
	deploy,
	type DriverRegistry,
	flattenConfig,
	selectEnvironment,
} from "#src/index";
import { BADGE_TRAP } from "#tests/helpers/drivers";

const trap = {
	async create() {
		throw new Error("Unexpected create");
	},
	async retire() {
		throw new Error("Unexpected retirement in this fixture");
	},
};

const config: Config = {
	environments: { production: {} },
	passes: {
		"vip-plus": {
			name: "VIP",
			description: "Perks",
			icon: { "en-us": "vip.png" },
			movedFrom: "vip",
		},
	},
};

async function readFileAsync(): Promise<Uint8Array> {
	return new Uint8Array([1, 2, 3]);
}

describe("resource key renames", () => {
	it("should persist a noop pass rename with its original Roblox outputs and no requests", async ({
		expect,
	}) => {
		expect.assertions(3);

		const selected = selectEnvironment(config, "production");
		assert(selected.success);
		const built = await buildDesired({
			readFile: readFileAsync,
			resources: flattenConfig(selected.data),
		});
		assert(built.success);
		const entry = built.data[0]!;
		assert(!("retired" in entry) && entry.kind === "gamePass");
		const { movedFrom: _movedFrom, ...desired } = entry;
		const initial: BedrockState = {
			environment: "production",
			resources: [
				{
					...desired,
					key: asResourceKey("vip"),
					outputs: {
						assetId: asRobloxAssetId("123"),
						iconAssetIds: { "en-us": asRobloxAssetId("456") },
					},
				},
			],
			version: 1,
		};
		const http = createFakeHttpClient();
		const registry: DriverRegistry = {
			badge: BADGE_TRAP,
			developerProduct: trap,
			gamePass: createGamePassDriver({
				client: new GamePassesClient({
					credential: { apiKey: "test", kind: "apiKey" },
					httpClient: http,
				}),
				readFile: readFileAsync,
				universeId: asRobloxAssetId("789"),
			}),
			place: trap,
			universe: trap,
		};
		const writes: Array<BedrockState> = [];
		const result = await deploy({
			config,
			environment: "production",
			readFile: readFileAsync,
			registry,
			statePort: {
				async read() {
					return { data: { state: initial }, success: true };
				},
				async write(state) {
					writes.push(state);
					return { data: undefined, success: true };
				},
			},
		});
		assert(result.success);

		expect(http.requests).toStrictEqual([]);
		expect(writes[0]!.resources).toStrictEqual([{ ...initial.resources[0], key: "vip-plus" }]);
		expect(result.data.resources[0]).not.toHaveProperty("movedFrom");
	});
});
