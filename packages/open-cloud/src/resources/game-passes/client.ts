import type { Except } from "type-fest";

import type {
	HttpClient,
	HttpRequest,
	OpenCloudClientOptions,
	OpenCloudHooks,
	RequestOptions,
	SleepFunc,
} from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { executeWithRetry } from "../../internal/http/execute.ts";
import { type OperationLimit, RateLimitQueue } from "../../internal/http/rate-limit-queue.ts";
import { resolveDependencies } from "../../internal/http/resolve-dependencies.ts";
import {
	CREATE_METHOD_DEFAULTS,
	defaultRetryDelay,
	IDEMPOTENT_METHOD_DEFAULTS,
	mergeConfig,
	type MethodKind,
	type RetryResolvable,
} from "../../internal/http/retry.ts";
import type { Result } from "../../types.ts";
import { buildCreateRequest, buildGetRequest } from "./builders.ts";
import { CREATE_OPERATION_LIMIT, GET_OPERATION_LIMIT } from "./operations.ts";
import { parseGamePassResponse } from "./parsers.ts";
import type { CreateGamePassParameters, GamePass, GetGamePassParameters } from "./types.ts";

interface ExecuteCall {
	readonly methodDefaults: Partial<RetryResolvable>;
	readonly methodKind: MethodKind;
	readonly operationLimit: OperationLimit;
	readonly options: RequestOptions | undefined;
	readonly request: HttpRequest;
}

const CLIENT_DEFAULTS = Object.freeze({
	baseUrl: "https://apis.roblox.com",
	maxRetries: 3,
	retryableStatuses: IDEMPOTENT_METHOD_DEFAULTS.retryableStatuses,
	retryDelay: defaultRetryDelay,
	timeout: 30_000,
} satisfies Except<RetryResolvable, "apiKey">);

/**
 * Public client for the Roblox Open Cloud Game Passes API.
 *
 * Wires request builders, the injected {@link HttpClient}, and response
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
	readonly #config: Readonly<RetryResolvable>;
	readonly #hooks: OpenCloudHooks;
	readonly #httpClient: HttpClient;
	readonly #queues = new Map<string, RateLimitQueue>();
	readonly #sleep: SleepFunc;

	/**
	 * Creates a new {@link GamePassesClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key and
	 *   optional test seams.
	 */
	constructor(options: OpenCloudClientOptions) {
		const { apiKey, hooks, httpClient, sleep, ...overrides } = options;
		const resolved = resolveDependencies({ httpClient, sleep });
		this.#httpClient = resolved.httpClient;
		this.#sleep = resolved.sleep;
		this.#hooks = hooks ?? {};
		this.#config = Object.freeze({
			...CLIENT_DEFAULTS,
			apiKey,
			...overrides,
		});
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
		return this.#execute({
			methodDefaults: CREATE_METHOD_DEFAULTS,
			methodKind: "create",
			operationLimit: CREATE_OPERATION_LIMIT,
			options,
			request: buildCreateRequest(parameters),
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
		return this.#execute({
			methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
			methodKind: "idempotent",
			operationLimit: GET_OPERATION_LIMIT,
			options,
			request: buildGetRequest(parameters),
		});
	}

	async #execute(call: ExecuteCall): Promise<Result<GamePass, OpenCloudError>> {
		const merged = mergeConfig(this.#config, {
			methodDefaults: call.methodDefaults,
			methodKind: call.methodKind,
			requestOptions: call.options ?? {},
		});
		const requestConfig = {
			apiKey: merged.apiKey,
			baseUrl: merged.baseUrl,
			timeout: merged.timeout,
		};
		const queue = this.#getQueue(merged.apiKey, call.operationLimit);
		const httpResult = await queue.acquire(async () => {
			return executeWithRetry(call.request, {
				config: merged,
				hooks: this.#hooks,
				send: async (toSend) => this.#httpClient.request(toSend, requestConfig),
				sleep: this.#sleep,
			});
		});
		if (!httpResult.success) {
			return httpResult;
		}

		return parseGamePassResponse(httpResult.data.body, httpResult.data.status);
	}

	#getQueue(apiKey: string, limit: OperationLimit): RateLimitQueue {
		const key = `${apiKey}::${limit.operationKey}`;
		const existing = this.#queues.get(key);
		if (existing !== undefined) {
			return existing;
		}

		const queue = new RateLimitQueue(limit, this.#hooks, this.#sleep);
		this.#queues.set(key, queue);
		return queue;
	}
}
