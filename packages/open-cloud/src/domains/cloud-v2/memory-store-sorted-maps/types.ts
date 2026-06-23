/**
 * Discriminated union describing a sorted-map item's sort key. The
 * server contract requires at most one of `stringSortKey` or
 * `numericSortKey`; the union surfaces that constraint at the type
 * level so callers cannot accidentally set both.
 *
 * @since 0.1.0
 */
export type SortKey =
	| { readonly kind: "numeric"; readonly value: number }
	| { readonly kind: "string"; readonly value: string };

/**
 * Caller-supplied input for the `create` method on
 * `StorageClient.sortedMaps`. Mirrors
 * `Cloud_CreateMemoryStoreSortedMapItem` on the Open Cloud API.
 *
 * @since 0.1.0
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
 * Caller-supplied input for the `list` method on
 * `StorageClient.sortedMaps`. Mirrors
 * `Cloud_ListMemoryStoreSortedMapItems` on the Open Cloud API. All
 * paging and filtering parameters are optional; omitting them returns
 * up to one item server-side (`maxPageSize` defaults to `1`).
 *
 * @since 0.1.0
 */
export interface ListSortedMapItemsParameters {
	/**
	 * Optional CEL filter on `id` and `sortKey`. The server supports
	 * `<`, `>`, and `&&` operators only; other operators are rejected
	 * server-side with a validation error.
	 */
	readonly filter?: string;
	/** Stringified sorted-map identifier. */
	readonly mapId: string;
	/**
	 * Maximum items per page. Capped at `100` server-side; values above
	 * the cap are clamped. Defaults to `1` when omitted.
	 */
	readonly maxPageSize?: number;
	/**
	 * Sort order. The server supports the `id` field only, with an
	 * optional ` desc` suffix.
	 */
	readonly orderBy?: string;
	/**
	 * Page token returned by a previous call. When supplied, all other
	 * parameters must match the previous call exactly.
	 */
	readonly pageToken?: string;
	/** Stringified ID of the universe that owns the sorted map. */
	readonly universeId: string;
}

/**
 * Parsed representation of a sorted-map item, as returned by every
 * sorted-map operation that yields a single item.
 *
 * @since 0.1.0
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

/**
 * Parsed result of a successful `Cloud_ListMemoryStoreSortedMapItems`
 * response.
 *
 * @since 0.1.0
 */
export interface ListSortedMapItemsResult {
	/** Items returned in the current page, ordered per `orderBy`. */
	readonly items: ReadonlyArray<SortedMapItem>;
	/**
	 * Page token for the next call, or `undefined` when no more pages
	 * exist. Pass back through `pageToken` to retrieve the next page.
	 */
	readonly nextPageToken: string | undefined;
}

/**
 * Caller-supplied input for the `delete` method on
 * `StorageClient.sortedMaps`. Mirrors
 * `Cloud_DeleteMemoryStoreSortedMapItem` on the Open Cloud API.
 *
 * @since 0.1.0
 */
export interface DeleteSortedMapItemParameters {
	/** Caller-supplied item identifier. URL-encoded by the builder. */
	readonly itemId: string;
	/** Stringified sorted-map identifier. */
	readonly mapId: string;
	/** Stringified ID of the universe that owns the sorted map. */
	readonly universeId: string;
}

/**
 * Caller-supplied input for the `get` method on
 * `StorageClient.sortedMaps`. Mirrors
 * `Cloud_GetMemoryStoreSortedMapItem` on the Open Cloud API.
 *
 * @since 0.1.0
 */
export interface GetSortedMapItemParameters {
	/** Caller-supplied item identifier. URL-encoded by the builder. */
	readonly itemId: string;
	/** Stringified sorted-map identifier. */
	readonly mapId: string;
	/** Stringified ID of the universe that owns the sorted map. */
	readonly universeId: string;
}

/**
 * Caller-supplied input for the `update` method on
 * `StorageClient.sortedMaps`. Mirrors
 * `Cloud_UpdateMemoryStoreSortedMapItem` on the Open Cloud API. Body
 * fields (`value`, `ttl`, `sortKey`) are optional under PATCH
 * semantics; omitted fields are left unchanged on the server.
 *
 * @since 0.1.0
 */
export interface UpdateSortedMapItemParameters {
	/**
	 * When `true`, the server creates the item if it does not exist
	 * instead of returning 404. Travels as the `allowMissing` query
	 * string parameter.
	 */
	readonly allowMissing?: boolean;
	/** Caller-supplied item identifier. URL-encoded by the builder. */
	readonly itemId: string;
	/** Stringified sorted-map identifier. */
	readonly mapId: string;
	/**
	 * Replacement sort key. Either kind of {@link SortKey} resets the
	 * field on the wire; omit the field to leave the existing sort key
	 * untouched.
	 */
	readonly sortKey?: SortKey;
	/**
	 * Replacement time-to-live in seconds. Omitted entries leave the
	 * existing TTL unchanged.
	 */
	readonly ttl?: number;
	/** Stringified ID of the universe that owns the sorted map. */
	readonly universeId: string;
	/** Replacement value. Omitted entries leave the existing value unchanged. */
	readonly value?: JSONValue;
}
