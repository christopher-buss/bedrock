import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import {
	buildDequeueRequest,
	buildEnqueueRequest,
} from "../../domains/cloud-v2/memory-store-queues/builders.ts";
import {
	DEQUEUE_OPERATION_LIMIT,
	DEQUEUE_REQUIRED_SCOPES,
	ENQUEUE_OPERATION_LIMIT,
	ENQUEUE_REQUIRED_SCOPES,
} from "../../domains/cloud-v2/memory-store-queues/operations.ts";
import {
	parseDequeueResponse,
	parseQueueItemResponse,
} from "../../domains/cloud-v2/memory-store-queues/parsers.ts";
import type {
	DequeueQueueItemsParameters,
	DequeueResult,
	EnqueueQueueItemParameters,
	QueueItem,
} from "../../domains/cloud-v2/memory-store-queues/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import {
	okRequest,
	type ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";

function makeSpec<P, R>(spec: ResourceMethodSpec<P, R>): ResourceMethodSpec<P, R> {
	return Object.freeze(spec);
}

const ENQUEUE_SPEC = makeSpec<EnqueueQueueItemParameters, QueueItem>({
	buildRequest: (parameters) => okRequest(buildEnqueueRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: ENQUEUE_OPERATION_LIMIT,
	parse: parseQueueItemResponse,
	requiredScopes: ENQUEUE_REQUIRED_SCOPES,
});

// Dequeue uses HTTP GET but mutates server state via the invisibility
// window. Retrying a 5xx where the server set invisibility before
// failing the response would lose the original batch (it stays
// invisible until the window elapses) and return a different one. So
// the retry policy mirrors `create`: only 429, never 5xx.
const DEQUEUE_SPEC = makeSpec<DequeueQueueItemsParameters, DequeueResult>({
	buildRequest: (parameters) => okRequest(buildDequeueRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: DEQUEUE_OPERATION_LIMIT,
	parse: parseDequeueResponse,
	requiredScopes: DEQUEUE_REQUIRED_SCOPES,
});

/**
 * Operation Group on `StorageClient` that exposes the memory-store
 * queue endpoints. Queues are FIFO collections of opaque JSON values
 * with optional priority and TTL; consumers enqueue items, dequeue
 * them in batches, and acknowledge processed batches with a read
 * identifier.
 */
export class MemoryStoreQueuesGroup {
	readonly #inner: ResourceClient;

	/**
	 * Wraps the shared {@link ResourceClient} so the Operation Group
	 * routes calls through the same retry, hooks, and rate-limit queues
	 * as the rest of the parent client.
	 *
	 * @param inner - The shared {@link ResourceClient} owned by the
	 *   parent client.
	 */
	constructor(inner: ResourceClient) {
		this.#inner = inner;
	}

	/**
	 * Dequeues up to `count` items from the front of the queue. Items
	 * returned become invisible to subsequent reads for
	 * `invisibilityWindow` seconds (default 30 server-side); they
	 * reappear once the window elapses unless acknowledged via
	 * `discard` with the returned `readId`.
	 *
	 * On 5xx, dequeue does not retry: the server may have set
	 * invisibility on a batch before the response failed, so a retry
	 * would return a *different* batch and the first one is lost until
	 * the window expires. Callers that can detect duplicates externally
	 * may opt back into 5xx retry per call by passing `retryableStatuses`
	 * on `options`.
	 *
	 * @param parameters - Universe and queue identifiers, plus optional
	 *   `count`, `allOrNothing`, and `invisibilityWindow`.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping the parsed {@link DequeueResult}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async dequeue(
		parameters: DequeueQueueItemsParameters,
		options?: RequestOptions,
	): Promise<Result<DequeueResult, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: DEQUEUE_SPEC });
	}

	/**
	 * Enqueues a single item onto a memory-store queue. The queue is
	 * auto-created on first use; the queue identifier is any string the
	 * caller picks. Items with higher `priority` values are dequeued
	 * first; equal priorities preserve insertion order. Items expire
	 * and are removed automatically after `ttl` seconds, or after a
	 * server-default lifetime when omitted.
	 *
	 * @param parameters - Universe and queue identifiers, the opaque
	 *   payload, and optional `priority` and `ttl`.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link QueueItem} or
	 *   the {@link OpenCloudError} that caused the request to fail.
	 */
	public async enqueue(
		parameters: EnqueueQueueItemParameters,
		options?: RequestOptions,
	): Promise<Result<QueueItem, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: ENQUEUE_SPEC });
	}
}
