import type { HttpClient, OpenCloudClientOptions } from "../../client/types.ts";
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
	readonly #apiKey: string;
	readonly #baseUrl: string;
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
		this.#apiKey = options.apiKey;
		this.#baseUrl = options.baseUrl ?? "https://apis.roblox.com";
		this.#httpClient = httpClient;
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
		const httpResult = await this.#httpClient.request(request, {
			apiKey: this.#apiKey,
			baseUrl: this.#baseUrl,
		});

		if (!httpResult.success) {
			return httpResult;
		}

		return parseGamePassResponse(httpResult.data.body, httpResult.data.status);
	}
}
