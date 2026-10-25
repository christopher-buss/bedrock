import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseQueueItemResponse } from "./parsers.ts";

// Captured on 2026-10-25 from apis.roblox.com using one-off calls with
// the request shapes in scripts/probe-memory-store-queues.ts. Universe,
// queue and item identifiers were replaced with stable fakes;
// field presence, nesting, types and timestamps are otherwise verbatim.

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
