import { ApiError } from "#src/errors/api-error";
import type { OpenCloudError } from "#src/errors/base";
import { NetworkError } from "#src/errors/network-error";
import { RateLimitError } from "#src/errors/rate-limit";
import type {
	HttpClient,
	HttpRequest,
	HttpResponse,
	RequestConfig,
} from "#src/internal/http/types";
import type { Result } from "#src/types";

import {
	FakeHttpClientContractError,
	type SchemaValidationMode,
	type SchemaViolation,
	validateRequestContract,
	validateResponseContract,
} from "./schema-contract.ts";

export {
	FakeHttpClientContractError,
	type SchemaValidationMode,
	type SchemaViolation,
} from "./schema-contract.ts";

/**
 * A request captured by {@link FakeHttpClient} for later assertion.
 */
export interface CapturedRequest {
	/** The per-request config passed alongside the request. */
	readonly config: RequestConfig;
	/** The request passed to {@link HttpClient.request}. */
	readonly request: HttpRequest;
}

/**
 * A fluent fake for the {@link HttpClient} boundary. Mocks are queued in
 * FIFO order and consumed by each `request()` call. Records every
 * request and config for later assertion. Throws
 * {@link FakeHttpClientError} if the queue is empty when `request()` is
 * called — surfaces missing mocks as test setup bugs instead of silently
 * repeating the last response.
 */
export interface FakeHttpClient extends HttpClient {
	/** Queues an {@link ApiError} with the given status code and optional message/code. */
	mockApiError(options: { code?: string; message?: string; statusCode: number }): FakeHttpClient;
	/** Queues an error Result with the given error instance. */
	mockError(error: OpenCloudError): FakeHttpClient;
	/** Queues a {@link NetworkError}. Preserves `cause` when provided. */
	mockNetworkError(options?: { cause?: unknown; message?: string }): FakeHttpClient;
	/** Queues a {@link RateLimitError} with the given retry hint. */
	mockRateLimit(options: { message?: string; retryAfterSeconds: number }): FakeHttpClient;
	/** Queues a successful {@link HttpResponse}. Body defaults to `{}`; headers default to `{}`. */
	mockResponse(options: {
		body?: unknown;
		headers?: Readonly<Record<string, string>>;
		status: number;
	}): FakeHttpClient;
	/** Number of queued mocks that have not yet been consumed. */
	readonly pendingMocks: number;
	/** Chronological log of every `(request, config)` pair the fake received. */
	readonly requests: ReadonlyArray<CapturedRequest>;
	/**
	 * Schema violations observed under `"warn"` mode. In `"strict"`
	 * mode the fake throws before this array can grow; in `"off"` mode
	 * it remains empty.
	 */
	readonly schemaViolations: ReadonlyArray<SchemaViolation>;
}

/**
 * Options accepted by {@link createFakeHttpClient}.
 */
export interface FakeHttpClientOptions {
	/** How strictly to enforce the vendored OpenAPI spec. Defaults to `"off"`. */
	readonly schemaValidation?: SchemaValidationMode;
}

type ErrorResult = Result<HttpResponse, OpenCloudError> & { success: false };

interface FakeState {
	readonly captured: Array<CapturedRequest>;
	consumed: number;
	readonly queue: Array<Result<HttpResponse, OpenCloudError>>;
	readonly violations: Array<SchemaViolation>;
}

/**
 * Thrown when {@link FakeHttpClient.request} is called but no mock has
 * been queued. The message names the method, url, and consumed count to
 * aid debugging of missing `.mockResponse`/`.mockError` setup.
 */
export class FakeHttpClientError extends Error {
	public override readonly name: string = "FakeHttpClientError";
}

/**
 * Creates a fluent {@link FakeHttpClient} that sits at the
 * {@link HttpClient} seam. Use for integration tests where you need to
 * assert per-request config (apiKey, baseUrl) flows through to HTTP.
 *
 * Defaults to `"strict"` contract validation against the vendored
 * OpenAPI spec so every new resource client inherits protection
 * automatically. Pass `{ schemaValidation: "off" }` to opt out for
 * tests that exercise the fake's own mechanics with synthetic URLs.
 *
 * @param fakeOptions - Behaviour flags; `schemaValidation` overrides
 *   the default `"strict"` contract checking.
 * @returns A fresh fake with an empty mock queue.
 */
export function createFakeHttpClient(fakeOptions: FakeHttpClientOptions = {}): FakeHttpClient {
	const mode: SchemaValidationMode = fakeOptions.schemaValidation ?? "strict";
	const state: FakeState = { captured: [], consumed: 0, queue: [], violations: [] };
	function enqueue(result: Result<HttpResponse, OpenCloudError>): FakeHttpClient {
		state.queue.push(result);
		return fake;
	}

	const fake: FakeHttpClient = {
		mockApiError: (options) => enqueue(errorResult(buildApiError(options))),
		mockError: (error) => enqueue(errorResult(error)),
		mockNetworkError: (options) => enqueue(errorResult(buildNetworkError(options))),
		mockRateLimit: (options) => enqueue(errorResult(buildRateLimitError(options))),
		mockResponse: (options) => enqueue(successResult(options)),
		get pendingMocks() {
			return state.queue.length;
		},
		request: async (request, config) => handleRequest({ config, mode, request, state }),
		get requests() {
			return state.captured;
		},
		get schemaViolations() {
			return state.violations;
		},
	};

	return fake;
}

function recordViolations(options: {
	readonly mode: SchemaValidationMode;
	readonly state: FakeState;
	readonly violations: ReadonlyArray<SchemaViolation>;
}): void {
	const [first, ...rest] = options.violations;
	if (first === undefined) {
		return;
	}

	if (options.mode === "strict") {
		throw new FakeHttpClientContractError(first);
	}

	options.state.violations.push(first, ...rest);
}

function consumeNextMock(
	state: FakeState,
	request: HttpRequest,
): Result<HttpResponse, OpenCloudError> {
	const next = state.queue.shift();
	if (next === undefined) {
		throw new FakeHttpClientError(
			`FakeHttpClient: no mock queued for ${request.method} ${request.url} (consumed ${String(state.consumed)}, pending 0)`,
		);
	}

	state.consumed += 1;
	return next;
}

async function handleRequest(options: {
	readonly config: RequestConfig;
	readonly mode: SchemaValidationMode;
	readonly request: HttpRequest;
	readonly state: FakeState;
}): Promise<Result<HttpResponse, OpenCloudError>> {
	const { config, mode, request, state } = options;
	state.captured.push({ config, request });
	if (mode !== "off") {
		recordViolations({ mode, state, violations: validateRequestContract(request) });
	}

	const result = consumeNextMock(state, request);
	if (mode !== "off" && result.success) {
		recordViolations({
			mode,
			state,
			violations: validateResponseContract(request, result.data),
		});
	}

	return result;
}

function successResult(options: {
	body?: unknown;
	headers?: Readonly<Record<string, string>>;
	status: number;
}): Result<HttpResponse, OpenCloudError> {
	return {
		data: {
			body: options.body ?? {},
			headers: options.headers ?? {},
			status: options.status,
		},
		success: true,
	};
}

function errorResult(err: OpenCloudError): ErrorResult {
	return { err, success: false };
}

function buildApiError(options: { code?: string; message?: string; statusCode: number }): ApiError {
	const message = options.message ?? "API error";
	if (options.code === undefined) {
		return new ApiError(message, { statusCode: options.statusCode });
	}

	return new ApiError(message, { code: options.code, statusCode: options.statusCode });
}

function buildNetworkError(
	options: undefined | { cause?: unknown; message?: string },
): NetworkError {
	const message = options?.message ?? "Network error";
	if (options?.cause === undefined) {
		return new NetworkError(message);
	}

	return new NetworkError(message, { cause: options.cause });
}

function buildRateLimitError(options: {
	message?: string;
	retryAfterSeconds: number;
}): RateLimitError {
	return new RateLimitError(options.message ?? "Rate limited", {
		retryAfterSeconds: options.retryAfterSeconds,
	});
}
