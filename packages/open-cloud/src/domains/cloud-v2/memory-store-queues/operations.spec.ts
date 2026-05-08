import { describe, expect, it } from "vitest";

import { ENQUEUE_OPERATION_LIMIT, ENQUEUE_REQUIRED_SCOPES } from "./operations.ts";

describe("memory-store queues enqueue operation limit", () => {
	it("should cap the enqueue endpoint at 1,000,000 requests per minute", () => {
		expect.assertions(1);

		expect(ENQUEUE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 1_000_000 / 60,
			operationKey: "memory-store-queues.enqueue",
		});
	});
});

describe("memory-store queues enqueue required scopes", () => {
	it("should require memory-store.queue:add", () => {
		expect.assertions(1);

		expect(ENQUEUE_REQUIRED_SCOPES).toStrictEqual(["memory-store.queue:add"]);
	});
});
