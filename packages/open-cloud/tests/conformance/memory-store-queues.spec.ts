import { describe, it } from "vitest";

import { expectValid, getValidator, loadFixture } from "./_helpers.ts";

describe("memory-store queue captures", () => {
	it.for([
		{ fixture: "enqueue-response.json", schema: "MemoryStoreQueueItem" },
		{ fixture: "dequeue-response.json", schema: "ReadMemoryStoreQueueItemsResponse" },
	])("should validate captured $fixture against $schema", ({ fixture, schema }, { expect }) => {
		expect.assertions(1);

		expectValid(expect, {
			fixture: loadFixture("memory-store-queues", fixture),
			validator: getValidator(schema),
		});
	});
});
