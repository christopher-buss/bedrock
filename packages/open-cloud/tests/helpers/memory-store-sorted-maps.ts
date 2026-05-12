import type {
	ListSortedMapItemsResponseWire,
	MemoryStoreSortedMapItemWire,
} from "#src/domains/cloud-v2/memory-store-sorted-maps/wire";

/**
 * Builds a minimally-valid {@link MemoryStoreSortedMapItemWire} body.
 * Pass an `overrides` object to tweak fields without re-stating the
 * defaults. The default carries a `stringSortKey`; pass
 * `{ stringSortKey: undefined, numericSortKey: 12 }` to test the
 * numeric branch.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validSortedMapItemBody(
	overrides: Partial<MemoryStoreSortedMapItemWire> = {},
): MemoryStoreSortedMapItemWire {
	return {
		id: "abc123",
		etag: 'W/"v1"',
		expireTime: "2026-06-21T15:08:58.4806559Z",
		path: "cloud/v2/universes/123/memory-store/sorted-maps/test-map/items/abc123",
		stringSortKey: "score-100",
		value: "hello",
		...overrides,
	};
}

/**
 * Builds a minimally-valid {@link ListSortedMapItemsResponseWire} body
 * carrying a single default sorted-map item. Pass an `overrides`
 * object to change the page token or supply a different items array.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid list response body with the overrides applied.
 */
export function validListSortedMapItemsBody(
	overrides: Partial<ListSortedMapItemsResponseWire> = {},
): ListSortedMapItemsResponseWire {
	return {
		memoryStoreSortedMapItems: [validSortedMapItemBody()],
		nextPageToken: undefined,
		...overrides,
	};
}
