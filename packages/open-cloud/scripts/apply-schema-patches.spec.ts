import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { findObsoletePatchDescriptions } from "./apply-schema-patches.ts";

const VENDOR_SPEC_PATH = fileURLToPath(new URL("../vendor/roblox-openapi.json", import.meta.url));

describe(findObsoletePatchDescriptions, () => {
	it("should flag every patch when the input contains none of the pre-patch shapes", () => {
		expect.assertions(1);

		expect(findObsoletePatchDescriptions("")).toStrictEqual([
			"MemoryStoreQueueItem.required gains 'data'",
			"MemoryStoreQueueItem.properties.path becomes readOnly",
			"ReadMemoryStoreQueueItemsResponse renames items→queueItems and readId→id",
			"MemoryStoreQueueItem.ttl drops invalid format: duration",
			"Cloud_ReadMemoryStoreQueueItems.invisibilityWindow drops invalid format: duration",
			"ListMemoryStoreSortedMapItemsResponse renames memoryStoreSortedMapItems→items",
		]);
	});

	it("should flag every patch when run against the post-patch vendored spec", () => {
		// The committed vendor spec is the post-patch state, so each
		// patch's `find` regex (which matches the pre-patch shape) no
		// longer matches. Verifying this gives a strong signal that
		// the patches genuinely transform the upstream into the post-
		// patch shape rather than landing as no-ops.
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");

		expect(findObsoletePatchDescriptions(text)).toHaveLength(6);
	});

	it("should not flag a patch when its pre-patch shape is present in the input", () => {
		// Reintroduce the pre-patch shape for the TTL patch: the field
		// gains back `"format": "duration"` after the description. The
		// other four patches' shapes remain absent, so they still flag.
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");
		const reverted = text.replace(
			/(\{memory_store_queue_item_id\}`",[\s\S]*?"description": "The TTL for the item\.")(\n {10}\})/,
			'$1,\n            "format": "duration"$2',
		);

		expect(findObsoletePatchDescriptions(reverted)).not.toContain(
			"MemoryStoreQueueItem.ttl drops invalid format: duration",
		);
	});
});
