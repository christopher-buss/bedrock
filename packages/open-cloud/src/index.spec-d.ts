import { describe, expectTypeOf, it } from "vitest";

import type {
	ApiError,
	ApiErrorOptions,
	HttpClient,
	HttpRequest,
	HttpResponse,
	NetworkError,
	OpenCloudClientOptions,
	OpenCloudError,
	OpenCloudHooks,
	RateLimitError,
	RateLimitErrorOptions,
	RequestOptions,
	Result,
	SleepFunc,
} from "./index.ts";

describe("Result", () => {
	it("should narrow to data branch when success is true", () => {
		const result = {} as Result<string>;

		if (result.success) {
			expectTypeOf(result.data).toBeString();
		}
	});

	it("should narrow to err branch when success is false", () => {
		const result = {} as Result<string>;

		if (!result.success) {
			expectTypeOf(result.err).toEqualTypeOf<Error>();
		}
	});

	it("should default error type to Error", () => {
		expectTypeOf<Result<string>>().toEqualTypeOf<
			{ data: string; success: true } | { err: Error; success: false }
		>();
	});

	it("should accept a custom error type", () => {
		expectTypeOf<Result<string, OpenCloudError>>().toEqualTypeOf<
			{ data: string; success: true } | { err: OpenCloudError; success: false }
		>();
	});
});

describe("OpenCloudError", () => {
	it("should extend Error", () => {
		expectTypeOf<OpenCloudError>().toExtend<Error>();
	});
});

describe("ApiError", () => {
	it("should be a subtype of OpenCloudError", () => {
		expectTypeOf<ApiError>().toExtend<OpenCloudError>();
	});

	it("should have statusCode as number", () => {
		expectTypeOf<ApiError>().toHaveProperty("statusCode").toBeNumber();
	});

	it("should have code as string or undefined", () => {
		expectTypeOf<ApiError>().toHaveProperty("code").toEqualTypeOf<string | undefined>();
	});
});

describe("ApiErrorOptions", () => {
	it("should require statusCode", () => {
		expectTypeOf<ApiErrorOptions>().toHaveProperty("statusCode").toBeNumber();
	});

	it("should have optional code", () => {
		expectTypeOf<ApiErrorOptions>().toExtend<{ code?: string | undefined }>();
	});

	it("should extend ErrorOptions", () => {
		expectTypeOf<ApiErrorOptions>().toExtend<ErrorOptions>();
	});
});

describe("NetworkError", () => {
	it("should be assignable to OpenCloudError", () => {
		expectTypeOf<NetworkError>().toExtend<OpenCloudError>();
	});
});

describe("RateLimitError", () => {
	it("should extend OpenCloudError", () => {
		expectTypeOf<RateLimitError>().toExtend<OpenCloudError>();
	});

	it("should have retryAfterSeconds as number", () => {
		expectTypeOf<RateLimitError>().toHaveProperty("retryAfterSeconds").toBeNumber();
	});
});

describe("RateLimitErrorOptions", () => {
	it("should require retryAfterSeconds", () => {
		expectTypeOf<RateLimitErrorOptions>().toHaveProperty("retryAfterSeconds").toBeNumber();
	});

	it("should extend ErrorOptions", () => {
		expectTypeOf<RateLimitErrorOptions>().toExtend<ErrorOptions>();
	});
});

describe("HttpRequest", () => {
	it("should have method restricted to the supported HTTP verbs", () => {
		expectTypeOf<HttpRequest>()
			.toHaveProperty("method")
			.toEqualTypeOf<"DELETE" | "GET" | "PATCH" | "POST">();
	});

	it("should have a string url", () => {
		expectTypeOf<HttpRequest>().toHaveProperty("url").toBeString();
	});
});

describe("HttpResponse", () => {
	it("should have a numeric status", () => {
		expectTypeOf<HttpResponse>().toHaveProperty("status").toBeNumber();
	});

	it("should have headers as a record of strings", () => {
		expectTypeOf<HttpResponse>()
			.toHaveProperty("headers")
			.toEqualTypeOf<Readonly<Record<string, string>>>();
	});
});

describe("HttpClient", () => {
	it("should expose a request method returning a Result", () => {
		expectTypeOf<HttpClient>()
			.toHaveProperty("request")
			.returns.resolves.toEqualTypeOf<Result<HttpResponse, OpenCloudError>>();
	});
});

describe("SleepFunc", () => {
	it("should accept ms and return a Promise<void>", () => {
		expectTypeOf<SleepFunc>().toEqualTypeOf<(ms: number) => Promise<void>>();
	});
});

describe("OpenCloudHooks", () => {
	it("should have an optional onRequest taking HttpRequest", () => {
		expectTypeOf<OpenCloudHooks>()
			.toHaveProperty("onRequest")
			.toEqualTypeOf<((request: HttpRequest) => void) | undefined>();
	});

	it("should have an optional onRetry taking attempt and OpenCloudError", () => {
		expectTypeOf<OpenCloudHooks>()
			.toHaveProperty("onRetry")
			.toEqualTypeOf<((attempt: number, error: OpenCloudError) => void) | undefined>();
	});

	it("should have an optional onRateLimit taking waitMs", () => {
		expectTypeOf<OpenCloudHooks>()
			.toHaveProperty("onRateLimit")
			.toEqualTypeOf<((waitMs: number) => void) | undefined>();
	});
});

describe("OpenCloudClientOptions", () => {
	it("should require apiKey as a string", () => {
		expectTypeOf<OpenCloudClientOptions>().toHaveProperty("apiKey").toBeString();
	});

	it("should have optional baseUrl, maxRetries, timeout", () => {
		expectTypeOf<OpenCloudClientOptions>().toExtend<{
			baseUrl?: string;
			maxRetries?: number;
			timeout?: number;
		}>();
	});

	it("should have optional retryableStatuses and retryDelay", () => {
		expectTypeOf<OpenCloudClientOptions>()
			.toHaveProperty("retryableStatuses")
			.toEqualTypeOf<ReadonlyArray<number> | undefined>();
		expectTypeOf<OpenCloudClientOptions>()
			.toHaveProperty("retryDelay")
			.toEqualTypeOf<((attempt: number) => number) | undefined>();
	});

	it("should expose hooks, httpClient, and sleep test seams as optional", () => {
		expectTypeOf<OpenCloudClientOptions>().toExtend<{
			hooks?: OpenCloudHooks;
			httpClient?: HttpClient;
			sleep?: SleepFunc;
		}>();
	});
});

describe("RequestOptions", () => {
	it("should cover every overridable client option without hooks or test seams", () => {
		expectTypeOf<RequestOptions>().toEqualTypeOf<
			Partial<
				Pick<
					OpenCloudClientOptions,
					| "apiKey"
					| "baseUrl"
					| "maxRetries"
					| "retryableStatuses"
					| "retryDelay"
					| "timeout"
				>
			>
		>();
	});

	it("should make apiKey optional so partial overrides are allowed", () => {
		expectTypeOf<RequestOptions>().toHaveProperty("apiKey").toEqualTypeOf<string | undefined>();
	});
});
