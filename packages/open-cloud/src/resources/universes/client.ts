import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { ResourceClient, type ResourceMethodSpec } from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import { buildGetRequest, buildUpdateRequest } from "./builders.ts";
import { GET_OPERATION_LIMIT, UPDATE_OPERATION_LIMIT } from "./operations.ts";
import { parseUniverseResponse } from "./parsers.ts";
import type { GetUniverseParameters, Universe, UpdateUniverseParameters } from "./types.ts";

const GET_SPEC: ResourceMethodSpec<GetUniverseParameters, Universe> = Object.freeze({
	buildRequest: buildGetRequest,
	methodDefaults: {},
	methodKind: "idempotent",
	operationLimit: GET_OPERATION_LIMIT,
	parse: parseUniverseResponse,
});

const UPDATE_SPEC: ResourceMethodSpec<UpdateUniverseParameters, Universe> = Object.freeze({
	buildRequest: buildUpdateRequest,
	methodDefaults: {},
	methodKind: "idempotent",
	operationLimit: UPDATE_OPERATION_LIMIT,
	parse: parseUniverseResponse,
});

/**
 * Public client for the Roblox Open Cloud `Universe` resource. Wires
 * the request builders, the injected
 * {@link OpenCloudClientOptions.httpClient}, and the response parser
 * into a single ergonomic surface. Every method returns a
 * {@link Result} so callers handle failure explicitly; no thrown
 * {@link OpenCloudError} ever escapes the client.
 *
 * Partial updates use a Google-style `updateMask` query string derived
 * from the keys present on the update parameters. Setting a clearable
 * field (`privateServerPriceRobux` or any social link) to `undefined`
 * sends JSON `null` for that field so the server clears the
 * corresponding value.
 *
 * @example
 *
 * ```ts
 * import { UniversesClient } from "@bedrock/ocale/universes";
 *
 * const client = new UniversesClient({ apiKey: "your-key" });
 * expect(client).toBeInstanceOf(UniversesClient);
 * ```
 */
export class UniversesClient {
	readonly #inner: ResourceClient;

	/**
	 * Creates a new {@link UniversesClient}. Configuration is frozen
	 * on construction; per-request overrides are accepted on each
	 * method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
	}

	/**
	 * Fetches the current configuration of a universe.
	 *
	 * @param parameters - The universe identifier.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link Universe}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async get(
		parameters: GetUniverseParameters,
		options?: RequestOptions,
	): Promise<Result<Universe, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: GET_SPEC });
	}

	/**
	 * Partially updates a universe's configuration. The fields
	 * supplied on `parameters` (excluding `universeId`) are forwarded
	 * to the server via a Google-style `updateMask`; unmentioned
	 * fields are left untouched.
	 *
	 * @param parameters - The universe identifier and the fields to
	 *   update. At least one updatable field must be supplied.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link Universe}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async update(
		parameters: UpdateUniverseParameters,
		options?: RequestOptions,
	): Promise<Result<Universe, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: UPDATE_SPEC });
	}
}
