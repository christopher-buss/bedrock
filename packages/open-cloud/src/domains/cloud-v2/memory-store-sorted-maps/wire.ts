// Wire-level shapes for responses returned by the Open Cloud memory-store
// sorted-map endpoints under `cloud/v2`. Internal to the sub-tree; not
// re-exported.

/**
 * Wire shape of a `MemoryStoreSortedMapItem` resource: the response body
 * returned by `Cloud_CreateMemoryStoreSortedMapItem`,
 * `Cloud_GetMemoryStoreSortedMapItem`, and
 * `Cloud_UpdateMemoryStoreSortedMapItem`, and the array entry inside
 * `Cloud_ListMemoryStoreSortedMapItems`. Either `stringSortKey` or
 * `numericSortKey` may be set on a single item, never both: the server
 * contract is one-of and a response carrying both is rejected by the
 * parser as malformed.
 */
export interface MemoryStoreSortedMapItemWire {
	/** Item identifier (also the final path component). */
	readonly id: string;
	/** Server-generated etag for optimistic concurrency. */
	readonly etag: string;
	/** ISO 8601 timestamp at which the item is removed from the map. */
	readonly expireTime: string;
	/** Numeric sort key. Mutually exclusive with `stringSortKey`. */
	readonly numericSortKey?: number | undefined;
	/**
	 * Resource path:
	 * `cloud/v2/universes/{u}/memory-store/sorted-maps/{m}/items/{i}`.
	 */
	readonly path: string;
	/** Lexicographic sort key. Mutually exclusive with `numericSortKey`. */
	readonly stringSortKey?: string | undefined;
	/** The opaque item payload. May be any JSON value including `null`. */
	readonly value: JSONValue;
}

/**
 * Wire shape of the `Cloud_ListMemoryStoreSortedMapItems` response.
 * The server emits the items array under `memoryStoreSortedMapItems`
 * and an optional `nextPageToken` when more items are available.
 *
 * Both fields are optional per the OpenAPI spec
 * (`ListMemoryStoreSortedMapItemsResponse` has no `required` array);
 * empty maps come back with `memoryStoreSortedMapItems` omitted or
 * JSON `null`. The parser normalizes both forms to `items: []`.
 */
export interface ListSortedMapItemsResponseWire {
	/**
	 * Items in the current page, ordered per the request's `orderBy`.
	 * Omitted or JSON `null` on an empty page; the parser normalizes
	 * both to an empty array.
	 */
	readonly memoryStoreSortedMapItems?: ReadonlyArray<MemoryStoreSortedMapItemWire> | undefined;
	/**
	 * Page token for the next call, or `undefined` when no more pages
	 * exist. JSON `null` is accepted on the wire and normalized to
	 * `undefined` by the parser.
	 */
	readonly nextPageToken?: string | undefined;
}
