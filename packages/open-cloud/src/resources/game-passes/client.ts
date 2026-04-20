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
import { parseGamePassResponse } from "./parsers.ts";
import type { CreateGamePassParameters, GamePass, GetGamePassParameters } from "./types.ts";

const CREATE_SPEC: ResourceMethodSpec<CreateGamePassParameters, GamePass> = Object.freeze({
	buildRequest: (parameters: CreateGamePassParameters) =>
		okRequest(buildCreateRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: CREATE_OPERATION_LIMIT,
	parse: parseGamePassResponse,
});

const GET_SPEC: ResourceMethodSpec<GetGamePassParameters, GamePass> = Object.freeze({
	buildRequest: (parameters: GetGamePassParameters) => okRequest(buildGetRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: GET_OPERATION_LIMIT,
	parse: parseGamePassResponse,
});

/**
 * Public client for the Roblox Open Cloud Game Passes API.
 *
 * Wires request builders, the injected {@link OpenCloudClientOptions.httpClient}, and response
 * parsers into a single ergonomic surface. Every method returns a
 * {@link Result} so callers handle failure explicitly; no thrown
 * `OpenCloudError` ever escapes the client.
 *
 * ```ts
 * import { GamePassesClient } from "@bedrock/ocale/game-passes";
 *
 * const client = new GamePassesClient({ apiKey: process.env.ROBLOX_API_KEY! });
 *
 * const result = await client.get({
 *     universeId: "1234567890",
 *     gamePassId: "9876543210",
 * });
 *
 * if (result.success) {
 *     console.log(`${result.data.name} (${result.data.id})`);
 * } else {
 *     console.error(result.err.message);
 * }
 * ```
 */
export class GamePassesClient {
	readonly #inner: ResourceClient;

	/**
	 * Creates a new {@link GamePassesClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
	}

	/**
	 * Creates a new game pass under the supplied universe.
	 *
	 * @param parameters - Creation fields including the universe and pass name.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping the parsed {@link GamePass} or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async create(
		parameters: CreateGamePassParameters,
		options?: RequestOptions,
	): Promise<Result<GamePass, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: CREATE_SPEC });
	}

	/**
	 * Reads a single game pass by ID.
	 *
	 * @param parameters - Universe and game pass identifiers.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link GamePass} or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async get(
		parameters: GetGamePassParameters,
		options?: RequestOptions,
	): Promise<Result<GamePass, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: GET_SPEC });
	}
}
