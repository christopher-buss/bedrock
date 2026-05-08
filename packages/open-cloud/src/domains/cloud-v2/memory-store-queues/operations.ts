import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const ENQUEUE_PER_MINUTE = 1_000_000;
const SECONDS_PER_MINUTE = 60;

/**
 * Per-second request ceiling for enqueueing a memory-store queue item,
 * from the Open Cloud OpenAPI schema (1,000,000 requests per minute per
 * API key owner). Keyed independently from the dequeue and discard
 * operations so the three do not share a queue; upstream quota
 * accounting is documented per-operation, and the conservative default
 * is fewer cross-method contention surprises.
 */
export const ENQUEUE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: ENQUEUE_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "memory-store-queues.enqueue",
});

/**
 * Scopes required to enqueue a memory-store queue item, sourced from
 * `x-roblox-scopes` on the `Cloud_CreateMemoryStoreQueueItem` operation
 * in the vendored OpenAPI schema.
 */
export const ENQUEUE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"memory-store.queue:add",
]);
