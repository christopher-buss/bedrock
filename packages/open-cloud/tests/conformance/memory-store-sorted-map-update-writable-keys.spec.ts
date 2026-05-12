import type { UpdateSortedMapItemParameters } from "#src/domains/cloud-v2/memory-store-sorted-maps/types";
import { describe, expect, expectTypeOf, it } from "vitest";

import { listWritablePropertyNames } from "./_helpers.ts";

// Type-level pin: every key in the parameter interface (minus the
// universeId, mapId, and itemId URL fields and the `allowMissing`
// query parameter) must appear in this union, and the union must not
// name a key that is not in the interface. Mirrors the create pin: the
// `sortKey` discriminated union does not appear in
// `UPDATE_WIRE_BODY_KEYS` because the builder projects it onto the
// wire as either `stringSortKey` or `numericSortKey`.
expectTypeOf<"sortKey" | "ttl" | "value">().toEqualTypeOf<
	Exclude<keyof UpdateSortedMapItemParameters, "allowMissing" | "itemId" | "mapId" | "universeId">
>();

/**
 * Wire-level body keys the update builder may emit, after projecting
 * the `sortKey` discriminated union onto its two underlying schema
 * fields. The runtime drift check asserts every entry is non-`readOnly`
 * on the `MemoryStoreSortedMapItem` schema, so an entry cannot name a
 * server-side readOnly field.
 */
const UPDATE_WIRE_BODY_KEYS = ["numericSortKey", "stringSortKey", "ttl", "value"] as const;

describe("updateSortedMapItemParameters writable-keys pin", () => {
	it.for(UPDATE_WIRE_BODY_KEYS)(
		"should expose %s as a non-readOnly property on the MemoryStoreSortedMapItem schema",
		(key) => {
			expect.assertions(1);
			expect(listWritablePropertyNames("MemoryStoreSortedMapItem")).toContain(key);
		},
	);
});
