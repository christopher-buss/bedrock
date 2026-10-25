// Wire-level shapes for responses returned by the Open Cloud memory-store
// queue endpoints under `cloud/v2`. Internal to the sub-tree; not
// re-exported.

/**
 * Wire shape of a `MemoryStoreQueueItem` resource: the response body
 * returned by `Cloud_CreateMemoryStoreQueueItem` and the array entry
 * inside `Cloud_ReadMemoryStoreQueueItems`. The server emits `path`,
 * `data`, `expireTime`, and an optional `priority`. Top-level `data`
 * is required server-side (the server returns 400 when absent or
 * `null`); nested `null` inside `data` is preserved on round-trip.
 */
export interface MemoryStoreQueueItemWire {
	/** The opaque queue payload. Always non-null at the top level. */
	readonly data: Exclude<JSONValue, null>;
	/** ISO 8601 timestamp at which the item is removed from the queue. */
	readonly expireTime: string;
	/**
	 * Resource path:
	 * `cloud/v2/universes/{u}/memory-store/queues/{q}/items/{i}`.
	 */
	readonly path: string;
	/** Optional priority; higher values are dequeued first. */
	readonly priority?: number | undefined;
}

/**
 * Wire shape of the `Cloud_ReadMemoryStoreQueueItems` response. The
 * server emits the items array under `queueItems` (vendored schema
 * names it `items`) and the read identifier under `id` (schema names
 * it `readId`); both deviations are corrected by `apply-schema-patches`,
 * so the wire interface here matches the patched schema.
 *
 * The schema leaves `queueItems` and `id` optional. The parser requires
 * both on a successful dequeue so drift cannot silently discard data or
 * lose the `:discard` token. Captured empty-queue reads return 404
 * NOT_FOUND, not a successful body with an omitted or null array.
 */
export interface ReadQueueItemsResponseWire {
	/** Identifier of the read operation, passed back to `:discard`. */
	readonly id: string;
	/**
	 * Items at the front of the queue, in dequeue order. The parser requires
	 * an explicit array; an explicit empty array remains valid.
	 */
	readonly queueItems: ReadonlyArray<MemoryStoreQueueItemWire>;
}
