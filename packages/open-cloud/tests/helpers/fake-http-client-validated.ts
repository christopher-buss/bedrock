import type { ApiError } from "#src/errors/api-error";
import type { OpenCloudError } from "#src/errors/base";
import type { NetworkError } from "#src/errors/network-error";
import type { RateLimitError } from "#src/errors/rate-limit";
import type {
	HttpClient,
	HttpRequest,
	HttpResponse,
	RequestConfig,
} from "#src/internal/http/types";
import type { Result } from "#src/types";

import { createFakeHttpClient as createLiteFakeHttpClient } from "./fake-http-client.ts";
import type { CapturedRequest } from "./fake-http-client.ts";
import {
	FakeHttpClientContractError,
	type SchemaValidationMode,
	type SchemaViolation,
	validateRequestContract,
	validateResponseContract,
} from "./schema-contract.ts";

export { type CapturedRequest, FakeHttpClientError } from "./fake-http-client.ts";
export {
	FakeHttpClientContractError,
	type SchemaValidationMode,
	type SchemaViolation,
} from "./schema-contract.ts";

/**
 * A fluent fake for the {@link HttpClient} boundary with contract
 * validation against the vendored OpenAPI spec. See
 * {@link createFakeHttpClient} for the wrapping semantics.
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
	/** How strictly to enforce the vendored OpenAPI spec. Defaults to `"strict"`. */
	readonly schemaValidation?: SchemaValidationMode;
}

interface ViolationState {
	readonly mode: SchemaValidationMode;
	readonly violations: Array<SchemaViolation>;
}

type LiteFakeHttpClient = ReturnType<typeof createLiteFakeHttpClient>;

/**
 * Creates a fluent {@link FakeHttpClient} that wraps the lite fake with
 * contract validation against the vendored OpenAPI spec. Use for
 * integration tests where you want every request and response checked
 * against the spec.
 *
 * Defaults to `"strict"` so every new resource client inherits
 * protection automatically. Pass `{ schemaValidation: "off" }` to opt
 * out for tests that exercise the fake's own mechanics with synthetic
 * URLs.
 *
 * @param fakeOptions - Behaviour flags; `schemaValidation` overrides
 *   the default `"strict"` contract checking.
 * @returns A fresh fake with an empty mock queue.
 */
export function createFakeHttpClient(fakeOptions: FakeHttpClientOptions = {}): FakeHttpClient {
	const lite = createLiteFakeHttpClient();
	const state: ViolationState = {
		mode: fakeOptions.schemaValidation ?? "strict",
		violations: [],
	};
	return buildWrapped(lite, state);
}

function forward(call: () => unknown, wrapped: FakeHttpClient): FakeHttpClient {
	call();
	return wrapped;
}

function recordViolations(state: ViolationState, violations: ReadonlyArray<SchemaViolation>): void {
	const [first, ...rest] = violations;
	if (first === undefined) {
		return;
	}

	if (state.mode === "strict") {
		throw new FakeHttpClientContractError(first);
	}

	state.violations.push(first, ...rest);
}

async function validatingRequest(options: {
	readonly config: RequestConfig;
	readonly lite: ReturnType<typeof createLiteFakeHttpClient>;
	readonly request: HttpRequest;
	readonly state: ViolationState;
}): Promise<Result<HttpResponse, OpenCloudError>> {
	const { config, lite, request, state } = options;
	if (state.mode !== "off") {
		recordViolations(state, validateRequestContract(request));
	}

	const result = await lite.request(request, config);
	if (state.mode !== "off" && result.success) {
		recordViolations(state, validateResponseContract(request, result.data));
	}

	return result;
}

function buildWrapped(lite: LiteFakeHttpClient, state: ViolationState): FakeHttpClient {
	const wrapped: FakeHttpClient = {
		mockApiError: (options) => forward(() => lite.mockApiError(options), wrapped),
		mockError: (error) => forward(() => lite.mockError(error), wrapped),
		mockNetworkError: (options) => forward(() => lite.mockNetworkError(options), wrapped),
		mockRateLimit: (options) => forward(() => lite.mockRateLimit(options), wrapped),
		mockResponse: (options) => forward(() => lite.mockResponse(options), wrapped),
		get pendingMocks() {
			return lite.pendingMocks;
		},
		request: async (request, config) => validatingRequest({ config, lite, request, state }),
		get requests() {
			return lite.requests;
		},
		get schemaViolations() {
			return state.violations;
		},
	};
	return wrapped;
}
