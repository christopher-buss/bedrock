import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseDequeueResponse, parseQueueItemResponse } from "./parsers.ts";

// Captured on 2026-10-25 from apis.roblox.com using one-off calls with
// the request shapes in scripts/probe-memory-store-queues.ts. Universe,
// queue, item and read identifiers were replaced with stable fakes;
// field presence, nesting, types and timestamps are otherwise verbatim.
// The dequeue capture pins the existing schema patch: queueItems and id,
// rather than the upstream spec's items and readId.

describe(parseQueueItemResponse, () => {
	it("should parse a captured enqueue response into a queue item", ({ expect }) => {
		expect.assertions(1);

		const body = loadFixture("memory-store-queues", "enqueue-response.json");

		const result = parseQueueItemResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "11111111-1111-4111-8111-111111111111",
			data: { hello: "world" },
			expiresAt: new Date("2026-10-25T02:07:26Z"),
			priority: 7,
			queueId: "test-queue",
			universeId: "123",
		});
	});
});

describe(parseDequeueResponse, () => {
	it("should parse a captured nonempty dequeue response using queueItems and id", ({
		expect,
	}) => {
		expect.assertions(1);

		const body = loadFixture("memory-store-queues", "dequeue-response.json");

		const result = parseDequeueResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			items: [
				{
					id: "11111111-1111-4111-8111-111111111111",
					data: { hello: "world" },
					expiresAt: new Date("2026-10-25T02:07:26.935Z"),
					priority: 7,
					queueId: "test-queue",
					universeId: "123",
				},
			],
			readId: "22222222-2222-4222-8222-222222222222",
		});
	});
});
