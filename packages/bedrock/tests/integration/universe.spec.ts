import {
	applyOps,
	asRobloxAssetId,
	buildDesired,
	createUniverseDriver,
	diff,
	type DriverRegistry,
	flattenConfig,
	loadConfig,
	type ResourceDriver,
	selectEnvironment,
	UNIVERSE_SINGLETON_KEY,
} from "@bedrock-rbx/core";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import { createFakeHttpClient, validUniverseBody } from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const UNIVERSE_FIXTURE_DIR = join(FIXTURES_ROOT, "universe");
const UNIVERSE_ID = asRobloxAssetId("1234567890");
const ROOT_PLACE_ID = asRobloxAssetId("4711");

const GAME_PASS_TRAP: ResourceDriver<"gamePass"> = {
	create() {
		throw new Error("GamePassDriver.create must not run for universe fixtures");
	},
};

const PLACE_TRAP: ResourceDriver<"place"> = {
	create() {
		throw new Error("PlaceDriver.create must not run for universe fixtures");
	},
};

const DEVELOPER_PRODUCT_TRAP: ResourceDriver<"developerProduct"> = {
	create() {
		throw new Error("DeveloperProductDriver.create must not run for universe fixtures");
	},
};

async function readFileNever(): Promise<Uint8Array> {
	throw new Error("readFile must not run for a universe-only config");
}

const DiscordLink = {
	title: "Join our Discord",
	uri: "https://discord.gg/example",
} as const;

function makeUniverseRegistry(httpClient: ReturnType<typeof createFakeHttpClient>): DriverRegistry {
	return {
		developerProduct: DEVELOPER_PRODUCT_TRAP,
		gamePass: GAME_PASS_TRAP,
		place: PLACE_TRAP,
		universe: createUniverseDriver({
			places: new PlacesClient({
				apiKey: "test-key",
				httpClient,
				sleep: async () => {},
			}),
			universes: new UniversesClient({
				apiKey: "test-key",
				httpClient,
				sleep: async () => {},
			}),
		}),
	};
}

describe("universe pipeline end-to-end", () => {
	it("should reconcile a declared universe through the full loadConfig to applyOps pipeline", async () => {
		expect.assertions(3);

		const loaded = await loadConfig({ cwd: UNIVERSE_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFileNever);
		assert(desiredResult.success);

		// `twitterSocialLink: undefined` in the fixture flows through as a
		// wire-level clear (JSON null), which the vendored OpenAPI does not
		// mark nullable. Opt out of strict contract validation so the
		// clear-via-undefined path remains observable end-to-end.
		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			body: validUniverseBody({
				path: `universes/${UNIVERSE_ID}`,
				rootPlace: `universes/${UNIVERSE_ID}/places/${ROOT_PLACE_ID}`,
			}),
			status: 200,
		});

		const registry = makeUniverseRegistry(httpClient);

		const ops = diff(desiredResult.data, []);

		expect(ops.map((op) => op.type)).toStrictEqual(["create"]);

		const applyResult = await applyOps(ops, registry);

		assert(applyResult.success);

		expect(applyResult.data).toHaveLength(1);
		expect(applyResult.data[0]).toStrictEqual({
			key: UNIVERSE_SINGLETON_KEY,
			consoleEnabled: undefined,
			desktopEnabled: false,
			discordSocialLink: DiscordLink,
			displayName: undefined,
			kind: "universe",
			mobileEnabled: undefined,
			outputs: { rootPlaceId: ROOT_PLACE_ID },
			tabletEnabled: undefined,
			twitterSocialLink: undefined,
			universeId: UNIVERSE_ID,
			voiceChatEnabled: true,
			vrEnabled: undefined,
		});
	});

	it("should emit an updateMask covering voiceChatEnabled, the set social link, the cleared social link, and desktopEnabled", async () => {
		expect.assertions(2);

		const loaded = await loadConfig({ cwd: UNIVERSE_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFileNever);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			body: validUniverseBody({
				path: `universes/${UNIVERSE_ID}`,
				rootPlace: `universes/${UNIVERSE_ID}/places/${ROOT_PLACE_ID}`,
			}),
			status: 200,
		});

		const registry = makeUniverseRegistry(httpClient);

		const applyResult = await applyOps(diff(desiredResult.data, []), registry);
		assert(applyResult.success);

		const [first] = httpClient.requests;
		assert(first);

		expect(httpClient.requests).toHaveLength(1);
		expect(new Set(extractUpdateMask(first.request.url))).toStrictEqual(
			new Set([
				"desktopEnabled",
				"discordSocialLink",
				"twitterSocialLink",
				"voiceChatEnabled",
			]),
		);
	});

	it("should emit a request body that sets discordSocialLink, clears twitterSocialLink, and forwards voiceChatEnabled", async () => {
		expect.assertions(4);

		const loaded = await loadConfig({ cwd: UNIVERSE_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFileNever);
		assert(desiredResult.success);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			body: validUniverseBody({
				path: `universes/${UNIVERSE_ID}`,
				rootPlace: `universes/${UNIVERSE_ID}/places/${ROOT_PLACE_ID}`,
			}),
			status: 200,
		});

		const registry = makeUniverseRegistry(httpClient);

		await applyOps(diff(desiredResult.data, []), registry);

		const [first] = httpClient.requests;
		assert(first);

		const body = first.request.body as Record<string, unknown>;

		expect(Object.keys(body).toSorted()).toStrictEqual(
			[
				"desktopEnabled",
				"discordSocialLink",
				"twitterSocialLink",
				"voiceChatEnabled",
			].toSorted(),
		);
		expect(body["discordSocialLink"]).toStrictEqual(DiscordLink);
		expect(body["twitterSocialLink"]).toBeNull();
		expect(body["voiceChatEnabled"]).toBeTrue();
	});

	it("should emit a noop and skip driver dispatch when current state matches the fixture", async () => {
		expect.assertions(2);

		const loaded = await loadConfig({ cwd: UNIVERSE_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFileNever);
		assert(desiredResult.success);

		const ops = diff(desiredResult.data, [
			{
				key: UNIVERSE_SINGLETON_KEY,
				consoleEnabled: undefined,
				desktopEnabled: false,
				discordSocialLink: DiscordLink,
				displayName: undefined,
				kind: "universe",
				mobileEnabled: undefined,
				outputs: { rootPlaceId: ROOT_PLACE_ID },
				tabletEnabled: undefined,
				twitterSocialLink: undefined,
				universeId: UNIVERSE_ID,
				voiceChatEnabled: true,
				vrEnabled: undefined,
			},
		]);

		expect(ops.map((op) => op.type)).toStrictEqual(["noop"]);

		const trapRegistry: DriverRegistry = {
			developerProduct: DEVELOPER_PRODUCT_TRAP,
			gamePass: GAME_PASS_TRAP,
			place: PLACE_TRAP,
			universe: {
				create() {
					throw new Error("UniverseDriver.create must not run for noop ops");
				},
				update() {
					throw new Error("UniverseDriver.update must not run for noop ops");
				},
			},
		};

		const applyResult = await applyOps(ops, trapRegistry);

		expect(applyResult.success).toBeTrue();
	});

	it("should emit an update op when the stored discordSocialLink drifts from the fixture", async () => {
		expect.assertions(2);

		const loaded = await loadConfig({ cwd: UNIVERSE_FIXTURE_DIR });
		assert(loaded.success);

		const resolved = selectEnvironment(loaded.data, "production");
		assert(resolved.success);

		const desiredResult = await buildDesired(flattenConfig(resolved.data), readFileNever);
		assert(desiredResult.success);

		const ops = diff(desiredResult.data, [
			{
				key: UNIVERSE_SINGLETON_KEY,
				consoleEnabled: undefined,
				desktopEnabled: false,
				discordSocialLink: { title: "Old Discord", uri: "https://discord.gg/old" },
				displayName: undefined,
				kind: "universe",
				mobileEnabled: undefined,
				outputs: { rootPlaceId: ROOT_PLACE_ID },
				tabletEnabled: undefined,
				twitterSocialLink: undefined,
				universeId: UNIVERSE_ID,
				voiceChatEnabled: true,
				vrEnabled: undefined,
			},
		]);

		expect(ops.map((op) => op.type)).toStrictEqual(["update"]);

		const [op] = ops;
		assert(op?.type === "update");

		expect(op.desired).toBe(desiredResult.data[0]);
	});
});

function extractUpdateMask(url: string): ReadonlyArray<string> {
	const query = url.slice(url.indexOf("?") + 1);
	const parameters = new URLSearchParams(query);
	const mask = parameters.get("updateMask");
	return mask === null ? [] : mask.split(",");
}
