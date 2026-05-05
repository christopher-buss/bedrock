import type { HttpRequest, OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import {
	buildCreateRequest,
	buildGetRequest,
	buildUpdateRequest,
} from "../../domains/developer-products/products/builders.ts";
import {
	CREATE_OPERATION_LIMIT,
	GET_OPERATION_LIMIT,
	GET_REQUIRED_SCOPES,
	UPDATE_OPERATION_LIMIT,
	WRITE_REQUIRED_SCOPES,
} from "../../domains/developer-products/products/operations.ts";
import { parseDeveloperProductResponse } from "../../domains/developer-products/products/parsers.ts";
import type {
	CreateDeveloperProductParameters,
	DeveloperProduct,
	GetDeveloperProductParameters,
	UpdateDeveloperProductParameters,
} from "../../domains/developer-products/products/types.ts";
import { buildUpdateRequest as buildLocaleNameDescRequest } from "../../domains/game-internationalization/developer-product-name-description/builders.ts";
import {
	LOCALIZATION_OPERATION_LIMIT,
	LOCALIZATION_REQUIRED_SCOPES,
} from "../../domains/game-internationalization/developer-product-name-description/operations.ts";
import type { UpdateDeveloperProductNameDescriptionParameters } from "../../domains/game-internationalization/developer-product-name-description/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import {
	okRequest,
	parseEmptyResponse,
	ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";

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
	requiredScopes: WRITE_REQUIRED_SCOPES,
});

const GET_SPEC = makeSpec<GetDeveloperProductParameters>({
	buildRequest: (parameters) => okRequest(buildGetRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: GET_OPERATION_LIMIT,
	parse: parseDeveloperProductResponse,
	requiredScopes: GET_REQUIRED_SCOPES,
});

function buildUpdateOkRequest(
	parameters: UpdateDeveloperProductParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildUpdateRequest(parameters));
}

const UPDATE_SPEC: ResourceMethodSpec<UpdateDeveloperProductParameters, undefined> = Object.freeze({
	buildRequest: buildUpdateOkRequest,
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: UPDATE_OPERATION_LIMIT,
	parse: parseEmptyResponse,
	requiredScopes: WRITE_REQUIRED_SCOPES,
});

function buildLocaleNameDescOkRequest(
	parameters: UpdateDeveloperProductNameDescriptionParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildLocaleNameDescRequest(parameters));
}

const UPDATE_NAME_DESCRIPTION_SPEC: ResourceMethodSpec<
	UpdateDeveloperProductNameDescriptionParameters,
	undefined
> = Object.freeze({
	buildRequest: buildLocaleNameDescOkRequest,
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: LOCALIZATION_OPERATION_LIMIT,
	parse: parseEmptyResponse,
	requiredScopes: LOCALIZATION_REQUIRED_SCOPES,
});

interface DeveloperProductLocalizationHandle {
	/**
	 * Updates the per-locale display name and/or description registered against
	 * a developer product. Either `name`, `description`, or both may be
	 * supplied; omitted fields are not forwarded so the server leaves the
	 * existing value for that locale untouched. Mirrors the upstream `200 OK`
	 * echo body as `undefined` data; callers that need the saved values can
	 * chain {@link DeveloperProductsClient.get} themselves.
	 *
	 * @param parameters - Product and language identifiers plus the optional
	 *   replacement values.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	updateNameDescription: (
		parameters: UpdateDeveloperProductNameDescriptionParameters,
		options?: RequestOptions,
	) => Promise<Result<undefined, OpenCloudError>>;
}

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
	 * Operation Group exposing per-locale localization Operations
	 * (`updateNameDescription`) backed by the
	 * `legacy-game-internationalization` domain. Source-language values
	 * remain on {@link DeveloperProductsClient.update}; methods on this
	 * group set per-locale overlays on top. Shares the parent client's
	 * HTTP, rate-limit, and retry plumbing.
	 */
	public readonly localization: DeveloperProductLocalizationHandle;

	/**
	 * Creates a new {@link DeveloperProductsClient}. Configuration is frozen
	 * on construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
		this.localization = createLocalizationHandle(this.#inner);
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

	/**
	 * Partially updates an existing developer product. Mirrors the upstream
	 * `204 No Content` response: a successful update yields `undefined` data.
	 * Callers that need the post-update state (for example to observe a
	 * server-derived `updatedTimestamp`) chain {@link DeveloperProductsClient.get}
	 * themselves so the GET only fires when actually needed.
	 *
	 * @param parameters - The universe and product identifiers and the
	 *   fields to update. Only fields explicitly provided are forwarded.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async update(
		parameters: UpdateDeveloperProductParameters,
		options?: RequestOptions,
	): Promise<Result<undefined, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: UPDATE_SPEC });
	}
}

function createLocalizationHandle(inner: ResourceClient): DeveloperProductLocalizationHandle {
	return {
		async updateNameDescription(parameters, options) {
			return inner.execute({ options, parameters, spec: UPDATE_NAME_DESCRIPTION_SPEC });
		},
	};
}
