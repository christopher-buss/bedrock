/**
 * Caller-supplied input for the `enqueue` method on `StorageClient.queues`.
 * Mirrors `Cloud_CreateMemoryStoreQueueItem` on the Open Cloud API.
 */
export interface EnqueueQueueItemParameters {
	/**
	 * Opaque queue payload. Round-trips as JSON, including nested `null`
	 * values inside objects and arrays. The top-level value cannot be
	 * `null`: the server rejects null payloads with a 400, so the type
	 * forbids it at compile time.
	 */
	readonly data: Exclude<JSONValue, null>;
	/**
	 * Optional priority. Higher values are dequeued first; equal priorities
	 * preserve insertion order. Omitted entries are inserted at the back of
	 * the queue.
	 */
	readonly priority?: number;
	/** Stringified queue identifier; the queue is auto-created on first use. */
	readonly queueId: string;
	/**
	 * Optional time-to-live in seconds. After this many seconds the item is
	 * automatically removed from the queue. Omitted entries inherit the
	 * server-default TTL.
	 */
	readonly ttl?: number;
	/** Stringified ID of the universe that owns the queue. */
	readonly universeId: string;
}

/**
 * Parsed representation of a memory-store queue item, as returned by the
 * Open Cloud `Cloud_CreateMemoryStoreQueueItem` and (inside the array)
 * `Cloud_ReadMemoryStoreQueueItems` endpoints.
 */
export interface QueueItem {
	/** Server-generated item identifier, parsed from the wire `path`. */
	readonly id: string;
	/**
	 * Opaque queue payload. Nested `null` values inside the JSON shape are
	 * preserved verbatim; only the top level is constrained.
	 */
	readonly data: Exclude<JSONValue, null>;
	/** Timestamp at which the server removes the item from the queue. */
	readonly expiresAt: Date;
	/** Priority recorded on the item, or `undefined` when none was set. */
	readonly priority: number | undefined;
	/** Stringified queue identifier, parsed from the wire `path`. */
	readonly queueId: string;
	/** Stringified universe identifier, parsed from the wire `path`. */
	readonly universeId: string;
}

/**
 * Caller-supplied input for the `dequeue` method on
 * `StorageClient.queues`. Mirrors `Cloud_ReadMemoryStoreQueueItems`.
 */
export interface DequeueQueueItemsParameters {
	/**
	 * If `true`, the server returns 404 when fewer than `count` items
	 * are available. Defaults to `false`, in which case the server
	 * returns whatever subset is currently at the front of the queue.
	 */
	readonly allOrNothing?: boolean;
	/**
	 * Number of items to read from the front of the queue. Defaults to
	 * `1`; values above `200` are clamped server-side.
	 */
	readonly count?: number;
	/**
	 * Number of seconds the dequeued items remain invisible to
	 * subsequent reads. Items not acknowledged via `discard` reappear
	 * once the window elapses. Defaults to `30` seconds server-side.
	 */
	readonly invisibilityWindow?: number;
	/** Stringified queue identifier. */
	readonly queueId: string;
	/** Stringified ID of the universe that owns the queue. */
	readonly universeId: string;
}

/**
 * Parsed result of a successful `Cloud_ReadMemoryStoreQueueItems`
 * response. The `readId` value must be passed to a subsequent
 * `discard` call to acknowledge the items; otherwise the items reappear
 * once the invisibility window elapses.
 */
export interface DequeueResult {
	/** Items dequeued from the front of the queue, in dequeue order. */
	readonly items: ReadonlyArray<QueueItem>;
	/**
	 * Identifier of the dequeue operation. Pass this to `discard` to
	 * remove the items from the queue permanently.
	 */
	readonly readId: string;
}
