// Wire-level shapes for responses returned by the Open Cloud memory-store
// queue endpoints under `cloud/v2`. Internal to the sub-tree; not
// re-exported.

/**
 * Wire shape of a `MemoryStoreQueueItem` resource — the response body
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
	/** Resource path: `cloud/v2/universes/{u}/memory-store/queues/{q}/items/{i}`. */
	readonly path: string;
	/** Optional priority; higher values are dequeued first. */
	readonly priority?: number | undefined;
}
