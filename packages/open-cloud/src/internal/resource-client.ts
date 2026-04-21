import type { Except } from "type-fest";

import type {
	HttpClient,
	HttpRequest,
	HttpResponse,
	OpenCloudClientOptions,
	OpenCloudHooks,
	RequestOptions,
	SleepFunc,
} from "../client/types.ts";
import type { OpenCloudError } from "../errors/base.ts";
import type { Result } from "../types.ts";
import { executeWithRetry } from "./http/execute.ts";
import { type OperationLimit, RateLimitQueue } from "./http/rate-limit-queue.ts";
import { resolveDependencies } from "./http/resolve-dependencies.ts";
import {
	defaultRetryDelay,
	IDEMPOTENT_METHOD_DEFAULTS,
	mergeConfig,
	type MethodKind,
	type RetryResolvable,
} from "./http/retry.ts";

/**
 * Describes a single resource method's shape for dispatch through
 * `ResourceClient.execute`. Each resource client declares one module-level
 * constant per public method; that constant binds the four resource-specific
 * values (request builder, response parser, retry-policy method kind,
 * operation-level rate limit) and flows through `execute` uniformly.
 *
 * @template P - The resource-specific parameter shape the builder
 *   accepts.
 * @template T - The resource-specific parsed success type the parser
 *   produces.
 */
export interface ResourceMethodSpec<P, T> {
	/**
	 * Builds the pure {@link HttpRequest} for a single call. Returns a
	 * {@link Result} so a builder can short-circuit with a local error
	 * (typically a {@link OpenCloudError} subclass such as `ValidationError`)
	 * before any HTTP, queue, or retry work happens. Builders that cannot
	 * fail wrap their return as `{ data: request, success: true }`.
	 */
	readonly buildRequest: (parameters: P) => Result<HttpRequest, OpenCloudError>;
	/** Method-level retry defaults merged into the resolved config. */
	readonly methodDefaults: Partial<RetryResolvable>;
	/**
	 * Method kind, controlling merge precedence: `"create"` lets method
	 * defaults win over client config so create safety cannot be relaxed
	 * silently; `"idempotent"` lets client config win over method defaults
	 * so consumers can loosen retry globally.
	 */
	readonly methodKind: MethodKind;
	/** Operation-level rate limit, keyed into the client's per-key queue map. */
	readonly operationLimit: OperationLimit;
	/**
	 * Converts the full {@link HttpResponse} into the resource-specific
	 * parsed shape. Takes the whole response (body, status, headers) so
	 * future parsers can read headers without widening the signature.
	 */
	readonly parse: (response: HttpResponse) => Result<T, OpenCloudError>;
}

/**
 * Single-argument bundle consumed by `ResourceClient.execute`: the per-method
 * spec, the resource-specific parameters, and optional per-request config
 * overrides.
 *
 * @template P - The resource-specific parameter shape the builder accepts.
 * @template T - The resource-specific parsed success type the parser produces.
 */
interface ExecuteCall<P, T> {
	/** Optional per-request config overrides. */
	readonly options?: RequestOptions | undefined;
	/** Resource-specific request parameters. */
	readonly parameters: P;
	/** Per-method binding of builder, parser, method kind, and operation limit. */
	readonly spec: ResourceMethodSpec<P, T>;
}

/**
 * Wraps an infallible request build as a {@link Result}-returning
 * `buildRequest` callback compatible with {@link ResourceMethodSpec}.
 * Use from a resource client whose builder cannot fail; resource clients
 * with local validation should construct the {@link Result} directly.
 *
 * @param request - The pre-built {@link HttpRequest}.
 * @returns A success Result wrapping the request.
 */
export function okRequest(request: HttpRequest): Result<HttpRequest, OpenCloudError> {
	return { data: request, success: true };
}

const CLIENT_DEFAULTS = Object.freeze({
	baseUrl: "https://apis.roblox.com",
	maxRetries: 3,
	retryableStatuses: IDEMPOTENT_METHOD_DEFAULTS.retryableStatuses,
	retryDelay: defaultRetryDelay,
	timeout: 30_000,
} satisfies Except<RetryResolvable, "apiKey">);

/**
 * Internal orchestrator shared by every Open Cloud resource client. Holds
 * the frozen client config, observability hooks, injected HTTP client and
 * sleep, and the per-effective-key rate-limit queue registry. Resource
 * classes compose one instance and dispatch every public method through
 * {@link ResourceClient.execute} with a per-method {@link ResourceMethodSpec}.
 * Not exported from any package subpath; reachable only via sibling
 * `src/resources/**` modules in this package.
 */
export class ResourceClient {
	readonly #config: Readonly<RetryResolvable>;
	readonly #hooks: OpenCloudHooks;
	readonly #httpClient: HttpClient;
	readonly #queues = new Map<string, RateLimitQueue>();
	readonly #sleep: SleepFunc;

	/**
	 * Creates a new {@link ResourceClient}. Resolves the injected HTTP
	 * client and sleep (defaulting to fetch + `setTimeout`) and freezes the
	 * merged client config so subsequent calls cannot mutate it.
	 *
	 * @param options - Client-level configuration including the API key
	 *   and optional construction-time test seams.
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
	 * Dispatches a single resource-method call. Merges the frozen client
	 * config with the method's `methodDefaults` and the caller's optional
	 * per-request `options`, routes through the effective-apiKey rate-limit
	 * queue, runs the retry loop, and finally parses the response with the
	 * spec's parser.
	 *
	 * @param call - The per-method spec, resource-specific parameters, and
	 *   optional per-request overrides.
	 * @returns The parsed success payload or the {@link OpenCloudError} that
	 *   caused the request to fail. Never throws.
	 */
	public async execute<P, T>(call: ExecuteCall<P, T>): Promise<Result<T, OpenCloudError>> {
		const { options, parameters, spec } = call;
		const merged = mergeConfig(this.#config, {
			methodDefaults: spec.methodDefaults,
			methodKind: spec.methodKind,
			requestOptions: options ?? {},
		});
		const requestResult = spec.buildRequest(parameters);
		if (!requestResult.success) {
			return requestResult;
		}

		const requestConfig = {
			apiKey: merged.apiKey,
			baseUrl: merged.baseUrl,
			timeout: merged.timeout,
		};
		const queue = this.#getQueue(merged.apiKey, spec.operationLimit);
		const httpResult = await queue.acquire(async () => {
			return executeWithRetry(requestResult.data, {
				config: merged,
				hooks: this.#hooks,
				send: async (toSend) => this.#httpClient.request(toSend, requestConfig),
				sleep: this.#sleep,
			});
		});
		if (!httpResult.success) {
			return httpResult;
		}

		return spec.parse(httpResult.data);
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
