import { describe, expect, it } from "vitest";

import { ApiError } from "./api-error.ts";
import { OpenCloudError } from "./base.ts";

describe(ApiError, () => {
	it("should set name to ApiError", () => {
		expect.assertions(1);

		const error = new ApiError("not found", { statusCode: 404 });

		expect(error.name).toBe("ApiError");
	});

	it("should set message from constructor argument", () => {
		expect.assertions(1);

		const error = new ApiError("internal server error", { statusCode: 500 });

		expect(error.message).toBe("internal server error");
	});

	it("should be an instance of OpenCloudError", () => {
		expect.assertions(1);

		const error = new ApiError("not found", { statusCode: 404 });

		expect(error).toBeInstanceOf(OpenCloudError);
	});

	it("should be an instance of Error", () => {
		expect.assertions(1);

		const error = new ApiError("not found", { statusCode: 404 });

		expect(error).toBeInstanceOf(Error);
	});

	it("should store statusCode", () => {
		expect.assertions(1);

		const error = new ApiError("not found", { statusCode: 404 });

		expect(error.statusCode).toBe(404);
	});

	it("should store code when provided", () => {
		expect.assertions(1);

		const error = new ApiError("not found", {
			code: "RESOURCE_NOT_FOUND",
			statusCode: 404,
		});

		expect(error.code).toBe("RESOURCE_NOT_FOUND");
	});

	it("should have undefined code when not provided", () => {
		expect.assertions(1);

		const error = new ApiError("not found", { statusCode: 404 });

		expect(error.code).toBeUndefined();
	});

	it("should store cause when provided", () => {
		expect.assertions(1);

		const cause = new Error("original");
		const error = new ApiError("not found", { cause, statusCode: 404 });

		expect(error.cause).toBe(cause);
	});
});
