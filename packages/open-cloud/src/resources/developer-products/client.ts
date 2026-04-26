import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import {
	okRequest,
	ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import { buildCreateRequest, buildGetRequest } from "./builders.ts";
import { CREATE_OPERATION_LIMIT, GET_OPERATION_LIMIT } from "./operations.ts";
import { parseDeveloperProductResponse } from "./parsers.ts";
import type {
	CreateDeveloperProductParameters,
	DeveloperProduct,
	GetDeveloperProductParameters,
} from "./types.ts";

function makeSpec<P>(
	spec: ResourceMethodSpec<P, DeveloperProduct>,
): ResourceMethodSpec<P, DeveloperProduct> {
	return Object.freeze(spec);
}

const CREATE_SPEC = makeSpec<CreateDeveloperProductParameters>({
	buildRequest: (parameters) => okRequest(buildCreateRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: CREATE_OPERATION_LIMIT,
	parse: parseDeveloperProductResponse,
});

const GET_SPEC = makeSpec<GetDeveloperProductParameters>({
	buildRequest: (parameters) => okRequest(buildGetRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: GET_OPERATION_LIMIT,
	parse: parseDeveloperProductResponse,
});

/**
 * Public client for the Roblox Open Cloud Developer Products API.
 *
 * Wires request builders, the injected {@link OpenCloudClientOptions.httpClient}, and response
 * parsers into a single ergonomic surface. Every method returns a
 * {@link Result} so callers handle failure explicitly; no thrown
 * `OpenCloudError` ever escapes the client.
 *
 * ```ts
 * import { DeveloperProductsClient } from "@bedrock/ocale/developer-products";
 *
 * const client = new DeveloperProductsClient({ apiKey: process.env.ROBLOX_API_KEY! });
 *
 * const result = await client.get({
 *     universeId: "1234567890",
 *     productId: "9876543210",
 * });
 *
 * if (result.success) {
 *     console.log(`${result.data.name} (${result.data.id})`);
 * } else {
 *     console.error(result.err.message);
 * }
 * ```
 */
export class DeveloperProductsClient {
	readonly #inner: ResourceClient;

	/**
	 * Creates a new {@link DeveloperProductsClient}. Configuration is frozen
	 * on construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
	}

	/**
	 * Creates a new developer product under the supplied universe.
	 *
	 * @param parameters - Creation fields including the universe and product name.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping the parsed {@link DeveloperProduct} or
	 *   the {@link OpenCloudError} that caused the request to fail.
	 */
	public async create(
		parameters: CreateDeveloperProductParameters,
		options?: RequestOptions,
	): Promise<Result<DeveloperProduct, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: CREATE_SPEC });
	}

	/**
	 * Reads a single developer product by ID.
	 *
	 * @param parameters - Universe and product identifiers.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link DeveloperProduct} or
	 *   the {@link OpenCloudError} that caused the request to fail.
	 */
	public async get(
		parameters: GetDeveloperProductParameters,
		options?: RequestOptions,
	): Promise<Result<DeveloperProduct, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: GET_SPEC });
	}
}
