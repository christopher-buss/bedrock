import type { HttpClient, OpenCloudClientOptions, RequestConfig } from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { resolveDependencies } from "../../internal/http/resolve-dependencies.ts";
import type { Result } from "../../types.ts";
import { buildGetRequest } from "./builders.ts";
import { parseGamePassResponse } from "./parsers.ts";
import type { GamePass, GetGamePassParameters } from "./types.ts";

/**
 * Public client for the Roblox Open Cloud Game Passes API.
 *
 * Wires request builders, the injected {@link HttpClient}, and response
 * parsers into a single ergonomic surface. Every method returns a
 * {@link Result} so callers handle failure explicitly — no thrown
 * `OpenCloudError` ever escapes the client.
 */
export class GamePassesClient {
	readonly #config: Readonly<RequestConfig>;
	readonly #httpClient: HttpClient;

	/**
	 * Creates a new {@link GamePassesClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key and
	 *   optional test seams.
	 */
	constructor(options: OpenCloudClientOptions) {
		const { httpClient } = resolveDependencies(options);
		this.#httpClient = httpClient;
		this.#config = Object.freeze({
			apiKey: options.apiKey,
			baseUrl: options.baseUrl ?? "https://apis.roblox.com",
			timeout: options.timeout ?? 30_000,
		});
	}

	/**
	 * Reads a single game pass by ID.
	 *
	 * @param parameters - Universe and game pass identifiers.
	 * @returns A {@link Result} wrapping the parsed {@link GamePass} or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async get(parameters: GetGamePassParameters): Promise<Result<GamePass, OpenCloudError>> {
		const request = buildGetRequest(parameters);
		const httpResult = await this.#httpClient.request(request, this.#config);

		if (!httpResult.success) {
			return httpResult;
		}

		return parseGamePassResponse(httpResult.data.body, httpResult.data.status);
	}
}
