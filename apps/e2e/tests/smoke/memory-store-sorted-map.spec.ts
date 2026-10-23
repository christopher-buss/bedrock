import { StorageClient } from "@bedrock-rbx/ocale/storage";

import process from "node:process";
import { assert, describe, it } from "vitest";

import { assertOk } from "../helpers/assert-ok.ts";
import { RESOURCE_PREFIX } from "../helpers/smoke-state-s3.ts";

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];

const HAS_SECRETS = API_KEY !== undefined && UNIVERSE_ID !== undefined;

// Items expire on their own after this many seconds, so a run that dies
// before cleanup leaves nothing behind for long.
const ITEM_TTL_SECONDS = 300;

describe.skipIf(!HAS_SECRETS)("memory-store sorted map via real Roblox", () => {
	it("should round-trip an item whose id contains URL-reserved characters", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(4);

		assert(API_KEY !== undefined, "BEDROCK_API_KEY must be set");
		assert(UNIVERSE_ID !== undefined, "ROBLOX_TEST_UNIVERSE_ID must be set");

		const client = new StorageClient({ credential: { apiKey: API_KEY, kind: "apiKey" } });
		const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const mapId = `${RESOURCE_PREFIX}-sorted-map-${runId}`;
		const itemId = `smoke/item:${runId} ?#%`;
		const value = { count: 1, label: `smoke ${runId}` };
		const keys = { itemId, mapId, universeId: UNIVERSE_ID };

		onTestFinished(async () => {
			const deleted = await client.sortedMaps.delete(keys);
			assertOk(deleted, "sorted-map delete");
		});

		const created = await client.sortedMaps.create({ ...keys, ttl: ITEM_TTL_SECONDS, value });
		assertOk(created, "sorted-map create");

		const fetched = await client.sortedMaps.get(keys);
		assertOk(fetched, "sorted-map get");

		expect(fetched.data.id).toBe(itemId);
		expect(fetched.data.value).toStrictEqual(value);

		const listed = await client.sortedMaps.list({
			mapId,
			maxPageSize: 100,
			universeId: UNIVERSE_ID,
		});
		assertOk(listed, "sorted-map list");

		expect(listed.data.items).not.toBeEmpty();
		expect(listed.data.items.map((item) => item.id)).toContain(itemId);
	}, 60_000);
});
