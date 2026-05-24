import { describe, expectTypeOf, it } from "vitest";

import type {
	ApiError,
	ApiErrorOptions,
	HttpClient,
	HttpRequest,
	HttpResponse,
	NetworkError,
	NetworkErrorOptions,
	OpenCloudClientOptions,
	OpenCloudError,
	OpenCloudHooks,
	Page,
	PermissionError,
	PermissionErrorOptions,
	RateLimitError,
	RateLimitErrorOptions,
	RequestConfig,
	RequestOptions,
	Result,
	SleepFunc,
	ValidationError,
	ValidationErrorCode,
	ValidationErrorOptions,
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

describe("Page", () => {
	it("should expose items as a readonly array of the item type", () => {
		expectTypeOf<Page<string>>().toHaveProperty("items").toEqualTypeOf<ReadonlyArray<string>>();
	});

	it("should expose nextPageToken as string or undefined", () => {
		expectTypeOf<Page<string>>()
			.toHaveProperty("nextPageToken")
			.toEqualTypeOf<string | undefined>();
	});

	it("should propagate the item type parameter", () => {
		interface Item {
			readonly id: string;
		}

		expectTypeOf<Page<Item>>().toEqualTypeOf<{
			readonly items: ReadonlyArray<Item>;
			readonly nextPageToken: string | undefined;
		}>();
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

	it("should have details as JSONValue or undefined", () => {
		expectTypeOf<ApiError>().toHaveProperty("details").toEqualTypeOf<JSONValue | undefined>();
	});
});

describe("ApiErrorOptions", () => {
	it("should require statusCode", () => {
		expectTypeOf<ApiErrorOptions>().toHaveProperty("statusCode").toBeNumber();
	});

	it("should have optional code", () => {
		expectTypeOf<ApiErrorOptions>().toExtend<{ code?: string | undefined }>();
	});

	it("should have optional details typed as JSONValue", () => {
		expectTypeOf<ApiErrorOptions>().toExtend<{ details?: JSONValue | undefined }>();
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

describe("NetworkErrorOptions", () => {
	it("should extend ErrorOptions with optional method and url strings", () => {
		expectTypeOf<NetworkErrorOptions>().toExtend<
			ErrorOptions & { method?: string | undefined; url?: string | undefined }
		>();
	});
});

describe("PermissionError", () => {
	it("should be a subtype of ApiError", () => {
		expectTypeOf<PermissionError>().toExtend<ApiError>();
	});

	it("should have requiredScopes as a readonly string array", () => {
		expectTypeOf<PermissionError>()
			.toHaveProperty("requiredScopes")
			.toEqualTypeOf<ReadonlyArray<string>>();
	});

	it("should have operationKey as a string", () => {
		expectTypeOf<PermissionError>().toHaveProperty("operationKey").toBeString();
	});
});

describe("PermissionErrorOptions", () => {
	it("should require requiredScopes as a readonly string array", () => {
		expectTypeOf<PermissionErrorOptions>()
			.toHaveProperty("requiredScopes")
			.toEqualTypeOf<ReadonlyArray<string>>();
	});

	it("should require operationKey as a string", () => {
		expectTypeOf<PermissionErrorOptions>().toHaveProperty("operationKey").toBeString();
	});

	it("should extend ApiErrorOptions", () => {
		expectTypeOf<PermissionErrorOptions>().toExtend<ApiErrorOptions>();
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

describe("ValidationErrorCode", () => {
	it("should equal the closed union of every supported validation code", () => {
		expectTypeOf<ValidationErrorCode>().toEqualTypeOf<
			| "empty_body"
			| "empty_image_ids"
			| "empty_update"
			| "format_mismatch"
			| "incomplete_ref"
			| "invalid_image_id"
		>();
	});
});

describe("ValidationError", () => {
	it("should be a subtype of OpenCloudError", () => {
		expectTypeOf<ValidationError>().toExtend<OpenCloudError>();
	});

	it("should have code typed as ValidationErrorCode", () => {
		expectTypeOf<ValidationError>().toHaveProperty("code").toEqualTypeOf<ValidationErrorCode>();
	});
});

describe("ValidationErrorOptions", () => {
	it("should require code as ValidationErrorCode", () => {
		expectTypeOf<ValidationErrorOptions>()
			.toHaveProperty("code")
			.toEqualTypeOf<ValidationErrorCode>();
	});

	it("should inherit from ErrorOptions so cause flows through", () => {
		expectTypeOf<ValidationErrorOptions>().toExtend<ErrorOptions>();
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

	it("should accept a RequestConfig on request", () => {
		expectTypeOf<HttpClient>()
			.toHaveProperty("request")
			.parameter(1)
			.toEqualTypeOf<RequestConfig>();
	});
});

describe("RequestConfig", () => {
	it("should require apiKey and baseUrl as strings", () => {
		expectTypeOf<RequestConfig>().toHaveProperty("apiKey").toBeString();
		expectTypeOf<RequestConfig>().toHaveProperty("baseUrl").toBeString();
	});

	it("should have optional timeout as number", () => {
		expectTypeOf<RequestConfig>().toHaveProperty("timeout").toEqualTypeOf<number | undefined>();
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
					| "retryableTransportCodes"
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
