import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import {
	buildCreateRequest,
	buildDeleteRequest,
	buildGetRequest,
	buildUpdateRequest,
} from "../../domains/cloud-v2/memory-store-sorted-maps/builders.ts";
import {
	CREATE_OPERATION_LIMIT,
	CREATE_REQUIRED_SCOPES,
	DELETE_OPERATION_LIMIT,
	DELETE_REQUIRED_SCOPES,
	GET_OPERATION_LIMIT,
	GET_REQUIRED_SCOPES,
	UPDATE_OPERATION_LIMIT,
	UPDATE_REQUIRED_SCOPES,
} from "../../domains/cloud-v2/memory-store-sorted-maps/operations.ts";
import { parseSortedMapItemResponse } from "../../domains/cloud-v2/memory-store-sorted-maps/parsers.ts";
import type {
	CreateSortedMapItemParameters,
	DeleteSortedMapItemParameters,
	GetSortedMapItemParameters,
	SortedMapItem,
	UpdateSortedMapItemParameters,
} from "../../domains/cloud-v2/memory-store-sorted-maps/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import {
	okRequest,
	parseEmptyResponse,
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

const DELETE_SPEC = makeSpec<DeleteSortedMapItemParameters, undefined>({
	buildRequest: (parameters) => okRequest(buildDeleteRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: DELETE_OPERATION_LIMIT,
	parse: parseEmptyResponse,
	requiredScopes: DELETE_REQUIRED_SCOPES,
});

const GET_SPEC = makeSpec<GetSortedMapItemParameters, SortedMapItem>({
	buildRequest: (parameters) => okRequest(buildGetRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: GET_OPERATION_LIMIT,
	parse: parseSortedMapItemResponse,
	requiredScopes: GET_REQUIRED_SCOPES,
});

const UPDATE_SPEC = makeSpec<UpdateSortedMapItemParameters, SortedMapItem>({
	buildRequest: (parameters) => okRequest(buildUpdateRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: UPDATE_OPERATION_LIMIT,
	parse: parseSortedMapItemResponse,
	requiredScopes: UPDATE_REQUIRED_SCOPES,
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

	/**
	 * Removes a single item from a sorted map. The call is idempotent:
	 * a second `delete` against the same item is a no-op once the
	 * server has dropped the row. The retry policy retries both 429
	 * and 5xx.
	 *
	 * @param parameters - Universe, sorted-map, and item identifiers.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping `undefined` on success or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async delete(
		parameters: DeleteSortedMapItemParameters,
		options?: RequestOptions,
	): Promise<Result<undefined, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: DELETE_SPEC });
	}

	/**
	 * Reads a single item from a sorted map. Returns the parsed
	 * {@link SortedMapItem} with the server-recorded `etag` for use in
	 * subsequent conditional updates (once the SDK begins emitting
	 * `If-Match`; see the package README).
	 *
	 * @param parameters - Universe, sorted-map, and item identifiers.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping the parsed {@link SortedMapItem}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async get(
		parameters: GetSortedMapItemParameters,
		options?: RequestOptions,
	): Promise<Result<SortedMapItem, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: GET_SPEC });
	}

	/**
	 * Updates a sorted-map item under PATCH semantics: omitted body
	 * fields are left unchanged on the server, supplied fields replace
	 * their existing values. Passing `allowMissing: true` creates the
	 * item when no row exists instead of returning 404.
	 *
	 * Retries 5xx because PATCH with the same body produces the same
	 * server state.
	 *
	 * @param parameters - Universe, sorted-map, and item identifiers,
	 *   plus any subset of `value`, `ttl`, `sortKey`, and
	 *   `allowMissing`.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping the parsed {@link SortedMapItem}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async update(
		parameters: UpdateSortedMapItemParameters,
		options?: RequestOptions,
	): Promise<Result<SortedMapItem, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: UPDATE_SPEC });
	}
}
