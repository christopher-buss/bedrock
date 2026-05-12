import type { CreateSortedMapItemParameters } from "#src/domains/cloud-v2/memory-store-sorted-maps/types";
import { describe, expect, expectTypeOf, it } from "vitest";

import { listWritablePropertyNames } from "./_helpers.ts";

// Type-level pin: every key in the parameter interface (minus the
// universeId, mapId, and itemId URL fields) must appear in this union,
// and the union must not name a key that is not in the interface. The
// pin diverges from the wire-body-keys array below because `sortKey` is
// a discriminated union that the builder projects into either
// `stringSortKey` or `numericSortKey` on the wire.
expectTypeOf<"sortKey" | "ttl" | "value">().toEqualTypeOf<
	Exclude<keyof CreateSortedMapItemParameters, "itemId" | "mapId" | "universeId">
>();

/**
 * Wire-level body keys the create builder may emit, after projecting
 * the `sortKey` discriminated union onto its two underlying schema
 * fields. The runtime drift check asserts every entry is non-`readOnly`
 * on the `MemoryStoreSortedMapItem` schema, so an entry cannot name a
 * server-side readOnly field.
 */
const CREATE_WIRE_BODY_KEYS = ["numericSortKey", "stringSortKey", "ttl", "value"] as const;

describe("createSortedMapItemParameters writable-keys pin", () => {
	it.for(CREATE_WIRE_BODY_KEYS)(
		"should expose %s as a non-readOnly property on the MemoryStoreSortedMapItem schema",
		(key) => {
			expect.assertions(1);
			expect(listWritablePropertyNames("MemoryStoreSortedMapItem")).toContain(key);
		},
	);
});
