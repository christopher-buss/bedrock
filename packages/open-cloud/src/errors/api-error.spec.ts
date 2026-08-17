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

	it("should store the request method and url when provided", () => {
		expect.assertions(2);

		const error = new ApiError("HTTP 400", {
			method: "POST",
			statusCode: 400,
			url: "https://apis.roblox.com/universes/v1/1/places/2/versions",
		});

		expect(error.method).toBe("POST");
		expect(error.url).toBe("https://apis.roblox.com/universes/v1/1/places/2/versions");
	});

	it("should store the elapsed request time when provided", () => {
		expect.assertions(1);

		const error = new ApiError("HTTP 400", { elapsedMs: 74_700, statusCode: 400 });

		expect(error.elapsedMs).toBe(74_700);
	});

	it("should store the allowlisted response headers when provided", () => {
		expect.assertions(1);

		const error = new ApiError("HTTP 400", {
			responseHeaders: { server: "haproxy" },
			statusCode: 400,
		});

		expect(error.responseHeaders).toStrictEqual({ server: "haproxy" });
	});

	it("should store the gateway summary when provided", () => {
		expect.assertions(1);

		const error = new ApiError("HTTP 400", {
			gatewaySummary: "400 Bad request",
			statusCode: 400,
		});

		expect(error.gatewaySummary).toBe("400 Bad request");
	});

	it("should store the unparsed body length when provided", () => {
		expect.assertions(1);

		const error = new ApiError("Failed to parse response body", {
			statusCode: 200,
			unparsedBodyLength: 1_572_740,
		});

		expect(error.unparsedBodyLength).toBe(1_572_740);
	});

	it("should default the request-context fields to undefined when omitted", () => {
		expect.assertions(5);

		const error = new ApiError("not found", { statusCode: 404 });

		expect(error.method).toBeUndefined();
		expect(error.url).toBeUndefined();
		expect(error.elapsedMs).toBeUndefined();
		expect(error.gatewaySummary).toBeUndefined();
		expect(error.responseHeaders).toBeUndefined();
	});

	it("should leave the unparsed body length undefined on an API rejection", () => {
		expect.assertions(1);

		const error = new ApiError("not found", { statusCode: 404 });

		expect(error.unparsedBodyLength).toBeUndefined();
	});
});
