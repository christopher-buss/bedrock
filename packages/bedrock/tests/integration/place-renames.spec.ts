import { PlacesClient } from "@bedrock-rbx/ocale/places";
import { createFakeHttpClient } from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import {
	asResourceKey,
	asRobloxAssetId,
	type BedrockState,
	type Config,
	createPlaceDriver,
	type DriverRegistry,
	provision,
	publish,
} from "#src/index";
import { placeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const trap = {
	async create() {
		throw new Error("Unexpected Roblox operation");
	},
	async retire() {
		throw new Error("Unexpected retirement in this fixture");
	},
};
const registry: DriverRegistry = {
	developerProduct: trap,
	gamePass: trap,
	place: trap,
	universe: trap,
};
const config: Config = {
	environments: { production: { places: { lobby: { placeId: "4711" } } } },
	places: { lobby: { filePath: "places/start.rbxl" } },
};

describe("place identity renames", () => {
	it("should honor an untrack declaration instead of implicitly adopting its place ID", async ({
		expect,
	}) => {
		expect.assertions(3);

		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [placeCurrent()],
					version: 1,
				},
			},
		});
		const result = await provision({
			config: {
				...config,
				places: { ...config.places, "start-place": { retired: "untrack" } },
			},
			environment: "production",
			async readFile() {
				throw new Error("Provision must not read a withheld artifact or marker");
			},
			registry,
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.resources).toStrictEqual([]);
		expect(result.data.pendingRebuild).toStrictEqual(new Set(["lobby"]));
		expect(store.writes).toHaveLength(1);
	});

	it("should refuse an unresolved orphan when the destination place already has state", async ({
		expect,
	}) => {
		expect.assertions(2);

		const initial: BedrockState = {
			environment: "production",
			resources: [placeCurrent(), placeCurrent({ key: asResourceKey("lobby") })],
			version: 1,
		};
		const store = fakeStateStore({ initial: { production: initial } });
		const result = await provision({
			config,
			environment: "production",
			async readFile() {
				throw new Error("Artifact is withheld");
			},
			registry,
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: {
				cause: { kind: "orphanRejected", orphans: [{ key: "start-place", kind: "place" }] },
				kind: "buildDesiredFailed",
			},
			success: false,
		});
		expect(store.writes).toBeEmpty();
	});

	it("should rebind an orphaned place by ID during provision without reading its artifact", async ({
		expect,
	}) => {
		expect.assertions(4);

		const initial: BedrockState = {
			environment: "production",
			pendingRebuild: new Set([asResourceKey("start-place")]),
			realDisplay: { "place:start-place": { displayName: "Real lobby" } },
			resources: [placeCurrent()],
			version: 1,
		};
		const store = fakeStateStore({ initial: { production: initial } });
		const result = await provision({
			config,
			environment: "production",
			async readFile() {
				throw new Error("Artifact is not built yet");
			},
			registry,
			statePort: store.port,
		});

		expect(result.success).toBe(true);
		expect(store.states.get("production")!.resources).toStrictEqual([
			{ ...initial.resources[0], key: "lobby" },
		]);
		expect(store.states.get("production")!.pendingRebuild).toStrictEqual(new Set(["lobby"]));
		expect(store.states.get("production")!.realDisplay).toStrictEqual({
			"place:lobby": { displayName: "Real lobby" },
		});
	});

	it("should reject a withheld place rename conflict before applying any assets or reading an artifact", async ({
		expect,
	}) => {
		expect.assertions(3);

		const conflicting: Config = {
			...config,
			environments: {
				production: { places: { lobby: { movedFrom: "start-place", placeId: "4711" } } },
			},
			products: { fresh: { name: "Fresh", description: "New" } },
		};
		const initial: BedrockState = {
			environment: "production",
			resources: [placeCurrent(), placeCurrent({ key: asResourceKey("lobby") })],
			version: 1,
		};
		const store = fakeStateStore({ initial: { production: initial } });
		const result = await provision({
			config: conflicting,
			environment: "production",
			async readFile() {
				throw new Error("Artifact is not built");
			},
			registry,
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: {
				cause: {
					kind: "renameRejected",
					message:
						"Cannot move 'start-place' to 'lobby' (place): both keys have current state.",
				},
				kind: "buildDesiredFailed",
			},
			success: false,
		});
		expect(store.writes).toStrictEqual([]);
		expect(store.states.get("production")).toBe(initial);
	});

	it("should move pending publish keys before selecting an explicit renamed place for publish", async ({
		expect,
	}) => {
		expect.assertions(3);

		const renamed: Config = {
			...config,
			environments: {
				production: { places: { lobby: { movedFrom: "start-place", placeId: "4711" } } },
			},
		};
		const initial: BedrockState = {
			environment: "production",
			pendingRebuild: new Set([asResourceKey("start-place")]),
			resources: [placeCurrent()],
			version: 1,
		};
		const store = fakeStateStore({ initial: { production: initial } });
		const result = await publish({
			config: renamed,
			environment: "production",
			async readFile() {
				return new Uint8Array([1, 2, 3]);
			},
			registry,
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.resources).toStrictEqual([{ ...initial.resources[0], key: "lobby" }]);
		expect(result.data.pendingRebuild).toStrictEqual(new Set(["lobby"]));
		expect(store.writes[0]!.expected).toStrictEqual({ kind: "present", token: "production-1" });
	});

	it("should keep a declared withheld place out of implicit rename candidates", async ({
		expect,
	}) => {
		expect.assertions(4);

		const full: Config = {
			environments: {
				production: {
					places: { "lobby": { placeId: "4711" }, "start-place": { placeId: "4711" } },
				},
			},
			places: { "lobby": {}, "start-place": { filePath: "places/start.rbxl" } },
		};
		const initial: BedrockState = {
			environment: "production",
			resources: [placeCurrent()],
			version: 1,
		};
		const store = fakeStateStore({ initial: { production: initial } });
		const http = createFakeHttpClient();
		const result = await provision({
			config: full,
			environment: "production",
			async readFile() {
				throw new Error("Artifact is not built");
			},
			registry: {
				...registry,
				place: createPlaceDriver({
					client: new PlacesClient({
						credential: { apiKey: "test", kind: "apiKey" },
						httpClient: http,
					}),
					async readFile() {
						throw new Error("Artifact is withheld");
					},
					universeId: asRobloxAssetId("123"),
				}),
			},
			statePort: store.port,
		});
		assert(result.success);

		expect(result.data.resources[0]).toStrictEqual(initial.resources[0]);
		expect(result.data.resources[1]).toMatchObject({
			key: "lobby",
			outputs: { versionNumber: undefined },
		});
		expect(result.data.pendingRebuild).toStrictEqual(new Set(["start-place"]));
		expect(http.requests).toStrictEqual([]);
	});
});
