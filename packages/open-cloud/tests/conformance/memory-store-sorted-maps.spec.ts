import { describe, it } from "vitest";

import { expectValid, getValidator, loadFixture } from "./_helpers.ts";

describe("memory-store sorted-map captures", () => {
	it.for(["list-response.json", "list-empty-response.json"])(
		"should validate captured %s against the sorted-map list schema",
		(fixture, { expect }) => {
			expect.assertions(1);

			expectValid(expect, {
				fixture: loadFixture("memory-store-sorted-maps", fixture),
				validator: getValidator("ListMemoryStoreSortedMapItemsResponse"),
			});
		},
	);
});
