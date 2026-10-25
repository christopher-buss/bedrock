import { StorageClient } from "@bedrock-rbx/ocale/storage";

import process from "node:process";
import { assert, describe, it } from "vitest";

import { assertOk } from "../helpers/assert-ok.ts";

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];

const HAS_SECRETS = API_KEY !== undefined && UNIVERSE_ID !== undefined;

// Items expire even if the run is interrupted before cleanup.
const ITEM_TTL_SECONDS = 300;

const QUEUE_PREFIX = "bedrock-smoke-queue";

async function discardQueueItemAsync(
	client: StorageClient,
	keys: { queueId: string; universeId: string },
	readId: string | undefined,
): Promise<void> {
	if (readId === undefined) {
		const remaining = await client.queues.dequeue({ ...keys, count: 1 });
		assertOk(remaining, "queue cleanup dequeue");
		({ readId } = remaining.data);
	}

	const discarded = await client.queues.discard({ ...keys, readId });
	assertOk(discarded, "queue discard");
}

describe("memory-store queue via real Roblox", () => {
	it.skipIf(!HAS_SECRETS)(
		"should enqueue, dequeue and discard an item with its original data",
		async ({ expect, onTestFinished }) => {
			expect.assertions(1);

			assert(API_KEY !== undefined, "BEDROCK_API_KEY must be set");
			assert(UNIVERSE_ID !== undefined, "ROBLOX_TEST_UNIVERSE_ID must be set");

			const client = new StorageClient({ credential: { apiKey: API_KEY, kind: "apiKey" } });
			const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			const keys = { queueId: `${QUEUE_PREFIX}-${runId}`, universeId: UNIVERSE_ID };
			const data = { count: 1, label: `smoke ${runId}` };

			const enqueued = await client.queues.enqueue({ ...keys, data, ttl: ITEM_TTL_SECONDS });
			let readId: string | undefined;
			onTestFinished(async () => {
				await discardQueueItemAsync(client, keys, readId);
			});
			assertOk(enqueued, "queue enqueue");

			const dequeued = await client.queues.dequeue({ ...keys, count: 1 });
			assertOk(dequeued, "queue dequeue");
			({ readId } = dequeued.data);

			expect(dequeued.data.items.map((item) => item.data)).toStrictEqual([data]);
		},
	);
});
