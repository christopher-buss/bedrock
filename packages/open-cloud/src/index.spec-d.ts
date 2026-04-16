import { describe, expectTypeOf, it } from "vitest";

import type {
	ApiError,
	ApiErrorOptions,
	NetworkError,
	OpenCloudError,
	RateLimitError,
	RateLimitErrorOptions,
	Result,
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
		expectTypeOf<ApiErrorOptions>().toMatchTypeOf<{ code?: string }>();
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
