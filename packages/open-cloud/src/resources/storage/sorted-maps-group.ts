import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import { buildCreateRequest } from "../../domains/cloud-v2/memory-store-sorted-maps/builders.ts";
import {
	CREATE_OPERATION_LIMIT,
	CREATE_REQUIRED_SCOPES,
} from "../../domains/cloud-v2/memory-store-sorted-maps/operations.ts";
import { parseSortedMapItemResponse } from "../../domains/cloud-v2/memory-store-sorted-maps/parsers.ts";
import type {
	CreateSortedMapItemParameters,
	SortedMapItem,
} from "../../domains/cloud-v2/memory-store-sorted-maps/types.ts";
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

const CREATE_SPEC = makeSpec<CreateSortedMapItemParameters, SortedMapItem>({
	buildRequest: (parameters) => okRequest(buildCreateRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: CREATE_OPERATION_LIMIT,
	parse: parseSortedMapItemResponse,
	requiredScopes: CREATE_REQUIRED_SCOPES,
});

/**
 * Operation Group on `StorageClient` that exposes the memory-store
 * sorted-map endpoints. Sorted maps are ordered collections of
 * (id, value, sortKey) triples; consumers create, read, update, list,
 * and delete items keyed by a caller-supplied identifier and ordered
 * by an optional string or numeric sort key.
 */
export class MemoryStoreSortedMapsGroup {
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
	 * Creates a single item in a sorted map. The sorted map is
	 * auto-created on first use; the map identifier is any string the
	 * caller picks. Items are keyed by `itemId` (case-sensitive) and
	 * ordered by an optional `sortKey`. Items expire and are removed
	 * automatically after `ttl` seconds, or after a server-default
	 * lifetime when omitted.
	 *
	 * On 5xx, create does not retry: Roblox Open Cloud has no
	 * idempotency-key support, so a retry of a transient failure risks
	 * producing a duplicate item.
	 *
	 * @param parameters - Universe, sorted-map, item identifiers, the
	 *   value to store, and optional `sortKey` and `ttl`.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link SortedMapItem}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async create(
		parameters: CreateSortedMapItemParameters,
		options?: RequestOptions,
	): Promise<Result<SortedMapItem, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: CREATE_SPEC });
	}
}
