import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

import { applyPatchesToText, findObsoletePatchDescriptions } from "./apply-schema-patches.ts";

const VENDOR_SPEC_PATH = fileURLToPath(new URL("../vendor/roblox-openapi.json", import.meta.url));

describe(findObsoletePatchDescriptions, () => {
	it("should flag every patch when the input contains none of the pre-patch shapes", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(findObsoletePatchDescriptions("")).toStrictEqual([
			"ListMemoryStoreSortedMapItemsResponse.nextPageToken becomes nullable",
			"MemoryStoreSortedMapItem.numericSortKey becomes nullable",
			"MemoryStoreQueueItem.required gains 'data'",
			"MemoryStoreQueueItem.properties.path becomes readOnly",
			"ReadMemoryStoreQueueItemsResponse renames items→queueItems and readId→id",
			"MemoryStoreQueueItem.ttl drops invalid format: duration",
			"Cloud_ReadMemoryStoreQueueItems.invisibilityWindow drops invalid format: duration",
			"MemoryStoreSortedMapItem.ttl drops invalid format: duration",
			"GetGameIconResponse.imageId becomes nullable",
			"BadgeAwarder type becomes the string enum Place",
		]);
	});

	it("should flag every patch when run against the post-patch vendored spec", ({ expect }) => {
		// The committed vendor spec is the post-patch state, so each
		// patch's `find` regex (which matches the pre-patch shape) no
		// longer matches. Verifying this gives a strong signal that
		// the patches genuinely transform the upstream into the post-
		// patch shape rather than landing as no-ops.
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");

		expect(findObsoletePatchDescriptions(text)).toHaveLength(10);
	});

	it("should not flag a patch when its pre-patch shape is present in the input", ({ expect }) => {
		// Reintroduce the pre-patch shape for the TTL patch: the field
		// gains back `"format": "duration"` after the description. The
		// other patches' shapes remain absent, so they still flag.
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

	it("should flag the queue ttl patch as obsolete when only the sorted-map ttl still has format: duration", ({
		expect,
	}) => {
		// Simulates a partial upstream fix: Roblox removes `format:
		// "duration"` from `MemoryStoreQueueItem.ttl` (committed
		// vendor state already reflects this) but leaves it on
		// `MemoryStoreSortedMapItem.ttl`. We re-introduce the sorted-
		// map drift to recreate that scenario. Two invariants are
		// checked:
		//   - the queue ttl patch IS reported as obsolete (the
		//     queue regex must not backtrack across the schema
		//     boundary into the sorted-map ttl)
		//   - the sorted-map ttl patch is NOT reported as obsolete
		//     (the sorted-map regex still finds its pre-patch shape,
		//     so it is still load-bearing)
		// This pins both the cross-schema safety of patch #4's
		// `(?!"MemoryStoreSortedMapItem":)` lookahead and the
		// reverse-direction correctness of patch #6's find regex.
		expect.assertions(2);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");
		const sortedMapReverted = text.replace(
			/("The server generated tag of an item\."[\s\S]*?"The TTL for the item\.")(\n {10}\})/,
			'$1,\n            "format": "duration"$2',
		);
		const obsolete = findObsoletePatchDescriptions(sortedMapReverted);

		expect(obsolete).toContain("MemoryStoreQueueItem.ttl drops invalid format: duration");
		expect(obsolete).not.toContain(
			"MemoryStoreSortedMapItem.ttl drops invalid format: duration",
		);
	});
});

describe(applyPatchesToText, () => {
	it("should restore captured sorted-map nullability without changing sibling schemas", ({
		expect,
	}) => {
		expect.assertions(2);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");
		const reverted = text
			.replace(
				/("ListMemoryStoreSortedMapItemsResponse": \{[\s\S]*?"nextPageToken": \{\n {12}"type": "string",)\n {12}"nullable": true,/,
				"$1",
			)
			.replace(
				/("MemoryStoreSortedMapItem": \{[\s\S]*?"numericSortKey": \{\n {12}"type": "number",)\n {12}"nullable": true,/,
				"$1",
			);

		expect(findObsoletePatchDescriptions(reverted)).not.toContain(
			"ListMemoryStoreSortedMapItemsResponse.nextPageToken becomes nullable",
		);
		expect(applyPatchesToText(reverted)).toStrictEqual({ already: 8, applied: 2, text });
	});

	it("should reject an unrecognized sorted-map token shape instead of patching a later token", ({
		expect,
	}) => {
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8").replace(
			/("ListMemoryStoreSortedMapItemsResponse": \{[\s\S]*?"nextPageToken": \{\n {12})"type": "string",\n {12}"nullable": true,/,
			'$1"type": "integer",',
		);

		expect(() => applyPatchesToText(text)).toThrow(
			"failed to apply patch: ListMemoryStoreSortedMapItemsResponse.nextPageToken becomes nullable",
		);
	});

	it("should report every patch as already applied on the post-patch vendored spec", ({
		expect,
	}) => {
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");

		expect(applyPatchesToText(text)).toStrictEqual({ already: 10, applied: 0, text });
	});

	it("should re-apply reverted patches and reproduce the committed spec byte-for-byte", ({
		expect,
	}) => {
		// Reverts two patches with different payload shapes and checks
		// the apply pass restores the committed post-patch state exactly.
		// Patch 1's payload inserts text around `$1`/`$2` group references
		// and patch 4's payload is the bare group reference `$1`, so a
		// byte-for-byte round-trip proves the references expand instead of
		// landing as literal `$n` tokens. That pins the 2026-08 regression
		// where a function replacer (`() => patch.replace`) inserted the
		// payload verbatim, corrupted the queue schema on the first patch,
		// and broke every subsequent patch in the weekly refresh flow.
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");
		const reverted = text
			.replace(
				',\n        "required": ["data"]\n      },\n      "MemoryStoreSortedMapItem":',
				'\n      },\n      "MemoryStoreSortedMapItem":',
			)
			.replace(
				/(\{memory_store_queue_item_id\}`",[\s\S]*?"description": "The TTL for the item\.")(\n {10}\})/,
				'$1,\n            "format": "duration"$2',
			);

		expect(applyPatchesToText(reverted)).toStrictEqual({ already: 8, applied: 2, text });
	});

	it("should re-apply the reverted game-icon and badge awarder patches byte-for-byte", ({
		expect,
	}) => {
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");
		const reverted = text
			.replace(
				'GetGameIconResponse": {\n        "type": "object",\n        "properties": {\n          "imageId": {\n            "type": "string",\n            "nullable": true',
				'GetGameIconResponse": {\n        "type": "object",\n        "properties": {\n          "imageId": {\n            "type": "string"',
			)
			.replace(
				'          "type": {\n            "enum": ["Place"],\n            "type": "string"',
				'          "type": {\n            "format": "int32",\n            "description": " [\'Place\' = 1]",\n            "enum": [1],\n            "type": "integer"',
			);

		expect(applyPatchesToText(reverted)).toStrictEqual({ already: 8, applied: 2, text });
	});

	it("should throw when a patch matches neither its pre-patch shape nor its applied marker", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(() => applyPatchesToText("")).toThrow(
			"failed to apply patch: ListMemoryStoreSortedMapItemsResponse.nextPageToken becomes nullable",
		);
	});
});
