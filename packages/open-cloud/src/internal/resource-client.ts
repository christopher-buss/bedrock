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
import { ApiError, requestContextOf } from "../errors/api-error.ts";
import type { OpenCloudError } from "../errors/base.ts";
import { PermissionError } from "../errors/permission-error.ts";
import { RequestAbortedError } from "../errors/request-aborted.ts";
import { RequestDeadlineExceededError } from "../errors/request-deadline-exceeded.ts";
import type { Result } from "../types.ts";
import type { AdmissionWaitContext } from "./http/admission-wait.ts";
import { BudgetGate, type BudgetScope } from "./http/budget-gate.ts";
import { executeWithRetryAsync } from "./http/execute.ts";
import { rateLimitSampleFromResult } from "./http/rate-limit-observation.ts";
import { type OperationLimit, RateLimitQueue } from "./http/rate-limit-queue.ts";
import {
	deadlineFailureFromError,
	elapsedDeadlineFailure,
	requestLifecycle,
	type RequestLifecycle,
} from "./http/request-deadline.ts";
import { resolveDependencies } from "./http/resolve-dependencies.ts";
import {
	defaultRetryDelay,
	IDEMPOTENT_METHOD_DEFAULTS,
	mergeConfig,
	type MethodKind,
	type RetryResolvable,
} from "./http/retry.ts";
import { isUploadRequest } from "./http/upload-request.ts";
import { requestAbortedError } from "./utils/abort.ts";

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
	/**
	 * Operation-level rate limit, keyed into the client's per-key queue map.
	 */
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
	/** Optionally refines a transport error with resource-specific evidence. */
	readonly refineError?: ((error: OpenCloudError) => OpenCloudError) | undefined;
	/**
	 * Per-method binding of builder, parser, method kind, and operation limit.
	 */
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
	/** Caller and deadline signal composed for the whole logical request. */
	readonly signal: AbortSignal | undefined;
}

interface DispatchInputs {
	readonly admission: AdmissionWaitContext;
	readonly merged: RetryResolvable;
	readonly operationLimit: OperationLimit;
	readonly refineError: ((error: OpenCloudError) => OpenCloudError) | undefined;
	readonly request: HttpRequest;
	readonly requestConfig: RequestConfig;
}

/** Inputs to the request-scoped budget-gated transport callback. */
interface GatedSendInputs {
	readonly admission: AdmissionWaitContext;
	readonly refineError: ((error: OpenCloudError) => OpenCloudError) | undefined;
	readonly requestConfig: RequestConfig;
	readonly scope: BudgetScope;
}

/** Request-only controls resolved before request construction. */
interface RequestStart {
	readonly admission: AdmissionWaitContext;
	readonly lifecycle: RequestLifecycle;
	readonly requestOptions: Partial<RetryResolvable>;
}

interface FinishRequestInputs<P, T> {
	readonly httpResult: Result<HttpResponse, OpenCloudError>;
	readonly lifecycle: RequestLifecycle;
	readonly spec: ResourceMethodSpec<P, T>;
}

/**
 * Internal orchestrator shared by every Open Cloud resource client. Holds
 * the frozen client config, observability hooks, injected HTTP client and
 * sleep, and the per-effective-key rate-limit queue registry. Resource
 * classes compose one instance and dispatch every public method through
 * {@link ResourceClient.executeAsync} with a per-method {@link ResourceMethodSpec}.
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
	constructor({ apiKey, hooks, httpClient, sleep, ...overrides }: OpenCloudClientOptions) {
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
	 * @rejects An unexpected collaborator failure unrelated to caller cancellation.
	 */
	public async executeAsync<P, T>({
		options,
		parameters,
		refineError,
		spec,
	}: ExecuteCall<P, T>): Promise<Result<T, OpenCloudError>> {
		const start = startRequest(options);
		if (!start.success) {
			return start;
		}

		const { admission, lifecycle, requestOptions } = start.data;
		const merged = mergeConfig(this.#config, {
			methodDefaults: spec.methodDefaults,
			methodKind: spec.methodKind,
			requestOptions,
		});
		const requestResult = spec.buildRequest(parameters);
		if (!requestResult.success) {
			return requestResult;
		}

		const request = requestResult.data;
		const { signal } = admission;
		const requestConfig = buildRequestConfig({ merged, options, request, signal });
		const httpResult = await this.#dispatchAsync({
			admission,
			merged,
			operationLimit: spec.operationLimit,
			refineError,
			request,
			requestConfig,
		});
		return finishRequest({ httpResult, lifecycle, spec });
	}

	/**
	 * Returns the sleep function used by this client instance.
	 *
	 * @returns The sleep function injected at construction time.
	 */
	public get sleep(): SleepFunc {
		return this.#sleep;
	}

	async #dispatchAsync({
		admission,
		merged,
		operationLimit,
		refineError,
		request,
		requestConfig,
	}: DispatchInputs): Promise<Result<HttpResponse, OpenCloudError>> {
		const queue = this.#getQueue(merged.apiKey, operationLimit);
		try {
			return await queue.acquireAsync(async () => {
				return executeWithRetryAsync(request, {
					admissionWaitObserver: admission.observer,
					config: merged,
					deadlineMs: admission.deadlineMs,
					hooks: this.#hooks,
					send: this.#gatedSend({
						admission,
						refineError,
						requestConfig,
						scope: {
							apiKey: merged.apiKey,
							operationKey: operationLimit.operationKey,
						},
					}),
					signal: admission.signal,
					sleep: this.#sleep,
				});
			}, admission);
		} catch (err) {
			return dispatchFailure(err);
		}
	}

	/**
	 * Builds the transport callback for one logical call, wrapping the HTTP
	 * client with the budget gate: each attempt waits on the scope's budget
	 * before sending, then folds the response's reported budget back in so the
	 * next attempt (or a later call on the same scope) can head off a 429.
	 *
	 * @param inputs - Budget scope, transport config, observer, and caller signal.
	 * @returns A send callback for {@link executeWithRetryAsync}.
	 */
	#gatedSend({
		admission,
		refineError,
		requestConfig,
		scope,
	}: GatedSendInputs): (request: HttpRequest) => Promise<Result<HttpResponse, OpenCloudError>> {
		return async (toSend) => {
			await this.#budgets.gateAsync(scope, admission);
			const transportResult = await this.#httpClient.request(toSend, requestConfig);
			const sendResult =
				refineError === undefined || transportResult.success
					? transportResult
					: { err: refineError(transportResult.err), success: false as const };
			this.#budgets.observe(scope, rateLimitSampleFromResult(sendResult));
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

function startRequest(options: RequestOptions | undefined): Result<RequestStart, OpenCloudError> {
	const callerSignal = options?.signal;
	if (callerSignal?.aborted === true) {
		return { err: requestAbortedError(callerSignal), success: false };
	}

	const lifecycle = requestLifecycle(options?.deadlineMs, callerSignal);
	const deadlineFailure = elapsedDeadlineFailure(lifecycle);
	if (deadlineFailure !== undefined) {
		return { err: deadlineFailure, success: false };
	}

	const { deadlineMs, onAdmissionWait, signal: _signal, ...requestOptions } = options ?? {};
	return {
		data: {
			admission: { deadlineMs, observer: onAdmissionWait, signal: lifecycle.signal },
			lifecycle,
			requestOptions,
		},
		success: true,
	};
}

function dispatchFailure(err: unknown): Result<never, OpenCloudError> {
	if (err instanceof RequestAbortedError || err instanceof RequestDeadlineExceededError) {
		return { err, success: false };
	}

	throw err;
}

/**
 * Resolves the per-request {@link RequestConfig}. Upload requests
 * ({@link isUploadRequest}) carry no default timeout: a multi-megabyte place
 * file over a slow link is bandwidth-bound, so a transport-attempt timeout only
 * fires spuriously. An explicit `options.timeout` still applies to any
 * request; every non-upload request keeps the merged default.
 *
 * @param inputs - The merged config, the built request, and per-request overrides.
 * @returns The config to hand to the transport, with `timeout` omitted when
 *   no transport-attempt timeout should apply.
 */
function buildRequestConfig({
	merged,
	options,
	request,
	signal,
}: RequestConfigInputs): RequestConfig {
	const shouldOmitDefaultTimeout = options?.timeout === undefined && isUploadRequest(request);
	return {
		apiKey: merged.apiKey,
		baseUrl: merged.baseUrl,
		...(signal === undefined ? {} : { signal }),
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

	// An edge gateway answers 401 and 403 for its own reasons, and the request
	// never reached the operation whose scopes these are.
	if (err.gatewaySummary !== undefined) {
		return err;
	}

	return new PermissionError(err.message, {
		...requestContextOf(err),
		cause: err.cause,
		code: err.code,
		details: err.details,
		operationKey: spec.operationLimit.operationKey,
		requiredScopes: spec.requiredScopes,
		statusCode: err.statusCode,
	});
}

function finishRequest<P, T>({
	httpResult,
	lifecycle,
	spec,
}: FinishRequestInputs<P, T>): Result<T, OpenCloudError> {
	if (httpResult.success) {
		return spec.parse(httpResult.data);
	}

	const deadlineFailure = deadlineFailureFromError(httpResult.err, lifecycle);
	return {
		err: deadlineFailure ?? enrichPermissionError(httpResult.err, spec),
		success: false,
	};
}
