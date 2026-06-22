import type { Except } from "type-fest";

import type {
	HttpClient,
	HttpRequest,
	HttpResponse,
	OpenCloudClientOptions,
	OpenCloudHooks,
	RequestConfig,
	RequestOptions,
	SleepFunc,
} from "../client/types.ts";
import { ApiError } from "../errors/api-error.ts";
import type { OpenCloudError } from "../errors/base.ts";
import { PermissionError } from "../errors/permission-error.ts";
import type { Result } from "../types.ts";
import { BudgetGate } from "./http/budget-gate.ts";
import { executeWithRetry } from "./http/execute.ts";
import { rateLimitSampleFromResult } from "./http/rate-limit-observation.ts";
import { type OperationLimit, RateLimitQueue } from "./http/rate-limit-queue.ts";
import { resolveDependencies } from "./http/resolve-dependencies.ts";
import {
	defaultRetryDelay,
	IDEMPOTENT_METHOD_DEFAULTS,
	mergeConfig,
	type MethodKind,
	type RetryResolvable,
} from "./http/retry.ts";
import { isUploadRequest } from "./http/upload-request.ts";

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
	/**
	 * Open Cloud scopes the API key or OAuth token must carry for this
	 * method, sourced from the vendored OpenAPI schema's `x-roblox-scopes`.
	 * When set, a 401 or 403 ApiError from the upstream call is upgraded to
	 * a {@link PermissionError} carrying these scopes alongside
	 * {@link OperationLimit.operationKey}, so callers can name the missing
	 * scope instead of just the HTTP status. Optional so test specs and
	 * not-yet-wired resources can opt out.
	 */
	readonly requiredScopes?: ReadonlyArray<string>;
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

/**
 * A {@link ResourceMethodSpec.parse} implementation for endpoints that return
 * no business payload on success (such as `DELETE` and reorder operations).
 * Surfaces `undefined` data and never inspects the response body.
 *
 * @returns A success Result with `undefined` data.
 */
export function parseEmptyResponse(): Result<undefined, OpenCloudError> {
	return { data: undefined, success: true };
}

const CLIENT_DEFAULTS = Object.freeze({
	baseUrl: "https://apis.roblox.com",
	maxRetries: 3,
	retryableStatuses: IDEMPOTENT_METHOD_DEFAULTS.retryableStatuses,
	retryableTransportCodes: IDEMPOTENT_METHOD_DEFAULTS.retryableTransportCodes,
	retryDelay: defaultRetryDelay,
	timeout: 30_000,
} satisfies Except<RetryResolvable, "apiKey">);

/**
 * Inputs to {@link buildRequestConfig}, bundled to keep the signature narrow.
 */
interface RequestConfigInputs {
	/** The resolved config for this call. */
	readonly merged: RetryResolvable;
	/** The caller's per-request overrides, if any. */
	readonly options: RequestOptions | undefined;
	/** The built request, inspected for an upload body. */
	readonly request: HttpRequest;
}

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
	readonly #budgets: BudgetGate;
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
		this.#budgets = new BudgetGate(this.#sleep);
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

		const requestConfig = buildRequestConfig({ merged, options, request: requestResult.data });
		const queue = this.#getQueue(merged.apiKey, spec.operationLimit);
		const httpResult = await queue.acquire(async () => {
			return executeWithRetry(requestResult.data, {
				config: merged,
				hooks: this.#hooks,
				send: this.#gatedSend(merged.apiKey, requestConfig),
				sleep: this.#sleep,
			});
		});
		if (!httpResult.success) {
			return { err: enrichPermissionError(httpResult.err, spec), success: false };
		}

		return spec.parse(httpResult.data);
	}

	/**
	 * Returns the sleep function used by this client instance.
	 *
	 * @returns The sleep function injected at construction time.
	 */
	public get sleep(): SleepFunc {
		return this.#sleep;
	}

	/**
	 * Builds the transport callback for one logical call, wrapping the HTTP
	 * client with the budget gate: each attempt waits on the API key's budget
	 * before sending, then folds the response's reported budget back in so the
	 * next attempt (or a sibling operation on the same key) can head off a 429.
	 *
	 * @param apiKey - The effective API key to gate on.
	 * @param requestConfig - The resolved per-request transport config.
	 * @returns A send callback for {@link executeWithRetry}.
	 */
	#gatedSend(
		apiKey: string,
		requestConfig: RequestConfig,
	): (request: HttpRequest) => Promise<Result<HttpResponse, OpenCloudError>> {
		return async (toSend) => {
			await this.#budgets.gate(apiKey);
			const sendResult = await this.#httpClient.request(toSend, requestConfig);
			this.#budgets.observe(apiKey, rateLimitSampleFromResult(sendResult));
			return sendResult;
		};
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

/**
 * Resolves the per-request {@link RequestConfig}. Upload requests
 * ({@link isUploadRequest}) carry no default timeout: a multi-megabyte place
 * file over a slow link is bandwidth-bound, so a client-side deadline only
 * fires spuriously. An explicit `options.timeout` still applies to any
 * request; every non-upload request keeps the merged default.
 *
 * @param inputs - The merged config, the built request, and per-request overrides.
 * @returns The config to hand to the transport, with `timeout` omitted when
 *   no client-side deadline should apply.
 */
function buildRequestConfig(inputs: RequestConfigInputs): RequestConfig {
	const { merged, options, request } = inputs;
	const shouldOmitDefaultTimeout = options?.timeout === undefined && isUploadRequest(request);
	return {
		apiKey: merged.apiKey,
		baseUrl: merged.baseUrl,
		...(shouldOmitDefaultTimeout ? {} : { timeout: merged.timeout }),
	};
}

function enrichPermissionError<P, T>(
	err: OpenCloudError,
	spec: ResourceMethodSpec<P, T>,
): OpenCloudError {
	if (spec.requiredScopes === undefined) {
		return err;
	}

	if (err instanceof PermissionError) {
		return err;
	}

	if (!(err instanceof ApiError)) {
		return err;
	}

	if (err.statusCode !== 401 && err.statusCode !== 403) {
		return err;
	}

	return new PermissionError(err.message, {
		cause: err.cause,
		code: err.code,
		operationKey: spec.operationLimit.operationKey,
		requiredScopes: spec.requiredScopes,
		statusCode: err.statusCode,
	});
}
