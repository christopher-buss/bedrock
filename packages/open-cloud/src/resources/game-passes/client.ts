import type {
	HttpClient,
	OpenCloudClientOptions,
	OpenCloudHooks,
	RequestOptions,
	SleepFunc,
} from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { executeWithRetry } from "../../internal/http/execute.ts";
import { resolveDependencies } from "../../internal/http/resolve-dependencies.ts";
import {
	defaultRetryDelay,
	IDEMPOTENT_METHOD_DEFAULTS,
	mergeConfig,
	type RetryResolvable,
} from "../../internal/http/retry.ts";
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
	readonly #config: Readonly<RetryResolvable>;
	readonly #hooks: OpenCloudHooks;
	readonly #httpClient: HttpClient;
	readonly #sleep: SleepFunc;

	/**
	 * Creates a new {@link GamePassesClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key and
	 *   optional test seams.
	 */
	constructor(options: OpenCloudClientOptions) {
		const { httpClient, sleep } = resolveDependencies(options);
		this.#httpClient = httpClient;
		this.#sleep = sleep;
		this.#hooks = options.hooks ?? {};
		this.#config = Object.freeze({
			apiKey: options.apiKey,
			baseUrl: options.baseUrl ?? "https://apis.roblox.com",
			maxRetries: options.maxRetries ?? 3,
			retryableStatuses:
				options.retryableStatuses ?? IDEMPOTENT_METHOD_DEFAULTS.retryableStatuses,
			retryDelay: options.retryDelay ?? defaultRetryDelay,
			timeout: options.timeout ?? 30_000,
		});
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
		const merged = mergeConfig(this.#config, {
			methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
			methodKind: "idempotent",
			requestOptions: options ?? {},
		});
		const requestConfig = {
			apiKey: merged.apiKey,
			baseUrl: merged.baseUrl,
			timeout: merged.timeout,
		};
		const httpResult = await executeWithRetry(buildGetRequest(parameters), {
			config: merged,
			hooks: this.#hooks,
			send: async (request) => this.#httpClient.request(request, requestConfig),
			sleep: this.#sleep,
		});

		if (!httpResult.success) {
			return httpResult;
		}

		return parseGamePassResponse(httpResult.data.body, httpResult.data.status);
	}
}
