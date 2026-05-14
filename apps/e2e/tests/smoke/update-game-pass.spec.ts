import {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	createGamePassDriver,
	type GamePassDesiredState,
	type ResourceCurrentState,
	type Sha256Hex,
} from "@bedrock-rbx/core";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { assert, describe, expect, it } from "vitest";

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID_ENV = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const GAME_PASS_ID_ENV = process.env["ROBLOX_TEST_GAME_PASS_ID"];
const ICON_PATH = process.env["ROBLOX_TEST_GAME_PASS_ICON_PATH"];

const HAS_SECRETS =
	API_KEY !== undefined && UNIVERSE_ID_ENV !== undefined && GAME_PASS_ID_ENV !== undefined;

const PLACEHOLDER_HASH = asSha256Hex("0".repeat(64));

describe("update game pass via real Roblox", () => {
	it.skipIf(!HAS_SECRETS)(
		"should PATCH name, description, and price for a fixed game pass",
		async () => {
			expect.assertions(3);

			assert(API_KEY !== undefined, "BEDROCK_API_KEY must be set");
			assert(UNIVERSE_ID_ENV !== undefined, "ROBLOX_TEST_UNIVERSE_ID must be set");
			assert(GAME_PASS_ID_ENV !== undefined, "ROBLOX_TEST_GAME_PASS_ID must be set");

			const universeId = asRobloxAssetId(UNIVERSE_ID_ENV);
			const gamePassId = asRobloxAssetId(GAME_PASS_ID_ENV);

			const stamp = String(Date.now());
			const desired = {
				key: asResourceKey("smoke-pass"),
				name: `smoke pass ${stamp}`,
				description: `smoke description ${stamp}`,
				icon: { "en-us": "unused.png" },
				iconFileHashes: { "en-us": PLACEHOLDER_HASH },
				kind: "gamePass",
				price: 100,
			} satisfies GamePassDesiredState;

			const current = {
				...desired,
				outputs: {
					assetId: gamePassId,
					iconAssetIds: { "en-us": gamePassId },
				},
			} satisfies ResourceCurrentState<"gamePass">;

			const driver = createGamePassDriver({
				client: new GamePassesClient({ apiKey: API_KEY }),
				readFile,
				universeId,
			});

			assert(driver.update !== undefined);
			const result = await driver.update(current, desired);

			assert(
				result.success,
				`driver.update failed: ${JSON.stringify(result.success ? null : result.err)}`,
			);

			expect(result.data.outputs.assetId).toBe(gamePassId);
			expect(result.data.name).toBe(desired.name);
			expect(result.data.description).toBe(desired.description);
		},
		60_000,
	);

	it.skipIf(!HAS_SECRETS || ICON_PATH === undefined)(
		"should PATCH a new icon for a fixed game pass and refresh the assigned icon asset id",
		async () => {
			expect.assertions(3);

			assert(API_KEY !== undefined, "BEDROCK_API_KEY must be set");
			assert(UNIVERSE_ID_ENV !== undefined, "ROBLOX_TEST_UNIVERSE_ID must be set");
			assert(GAME_PASS_ID_ENV !== undefined, "ROBLOX_TEST_GAME_PASS_ID must be set");
			assert(ICON_PATH !== undefined, "ROBLOX_TEST_GAME_PASS_ICON_PATH must be set");

			const universeId = asRobloxAssetId(UNIVERSE_ID_ENV);
			const gamePassId = asRobloxAssetId(GAME_PASS_ID_ENV);

			const iconBytes = await readFile(ICON_PATH);
			const iconHash = sha256Hex(iconBytes);

			const stamp = String(Date.now());
			const desired = {
				key: asResourceKey("smoke-pass"),
				name: `smoke pass icon ${stamp}`,
				description: `smoke icon update ${stamp}`,
				icon: { "en-us": ICON_PATH },
				iconFileHashes: { "en-us": iconHash },
				kind: "gamePass",
				price: 100,
			} satisfies GamePassDesiredState;

			const current = {
				...desired,
				iconFileHashes: { "en-us": PLACEHOLDER_HASH },
				outputs: {
					assetId: gamePassId,
					iconAssetIds: { "en-us": gamePassId },
				},
			} satisfies ResourceCurrentState<"gamePass">;

			const driver = createGamePassDriver({
				client: new GamePassesClient({ apiKey: API_KEY }),
				readFile,
				universeId,
			});

			assert(driver.update !== undefined);
			const result = await driver.update(current, desired);

			assert(
				result.success,
				`driver.update failed: ${JSON.stringify(result.success ? null : result.err)}`,
			);

			expect(result.data.outputs.assetId).toBe(gamePassId);
			expect(result.data.iconFileHashes["en-us"]).toBe(iconHash);
			expect(result.data.outputs.iconAssetIds["en-us"]).not.toBe(gamePassId);
		},
		60_000,
	);
});

function sha256Hex(bytes: Uint8Array): Sha256Hex {
	return asSha256Hex(createHash("sha256").update(bytes).digest("hex"));
}
