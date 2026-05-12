/**
 * Discriminated union describing a sorted-map item's sort key. The
 * server contract requires at most one of `stringSortKey` or
 * `numericSortKey`; the union surfaces that constraint at the type
 * level so callers cannot accidentally set both.
 */
export type SortKey =
	| { readonly kind: "numeric"; readonly value: number }
	| { readonly kind: "string"; readonly value: string };

/**
 * Caller-supplied input for the `create` method on
 * `StorageClient.sortedMaps`. Mirrors
 * `Cloud_CreateMemoryStoreSortedMapItem` on the Open Cloud API.
 */
export interface CreateSortedMapItemParameters {
	/**
	 * Caller-supplied item identifier. The server stores items
	 * case-sensitively; the value is URL-encoded by the builder.
	 */
	readonly itemId: string;
	/** Stringified sorted-map identifier. */
	readonly mapId: string;
	/** Optional sort key driving the item's position in the map. */
	readonly sortKey?: SortKey;
	/**
	 * Optional time-to-live in seconds. After this many seconds the
	 * item is automatically removed. Omitted entries inherit the
	 * server-default TTL.
	 */
	readonly ttl?: number;
	/** Stringified ID of the universe that owns the sorted map. */
	readonly universeId: string;
	/**
	 * Opaque item payload. May be any JSON value, including `null`,
	 * matching the protobuf `Value` contract on the wire.
	 */
	readonly value: JSONValue;
}

/**
 * Parsed representation of a sorted-map item, as returned by every
 * sorted-map operation that yields a single item.
 */
export interface SortedMapItem {
	/** Item identifier, parsed from the wire `path`. */
	readonly id: string;
	/**
	 * Server-generated etag for optimistic concurrency. Surfaced for
	 * caller inspection; the SDK does not yet emit an `If-Match` header
	 * for conditional update or delete.
	 */
	readonly etag: string;
	/** Timestamp at which the server removes the item from the map. */
	readonly expiresAt: Date;
	/** Stringified sorted-map identifier, parsed from the wire `path`. */
	readonly mapId: string;
	/**
	 * Parsed sort key, or `undefined` when the item has none. The server
	 * contract is one-of: a response carrying both `stringSortKey` and
	 * `numericSortKey` is rejected as malformed.
	 */
	readonly sortKey: SortKey | undefined;
	/** Stringified universe identifier, parsed from the wire `path`. */
	readonly universeId: string;
	/**
	 * Opaque item payload. Round-trips as JSON, including nested `null`
	 * values inside objects and arrays, and `null` at the top level.
	 */
	readonly value: JSONValue;
}
