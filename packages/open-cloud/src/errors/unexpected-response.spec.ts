import { describe, it } from "vitest";

import { ApiError } from "./api-error.ts";
import { OpenCloudError } from "./base.ts";
import { UnexpectedResponseError } from "./unexpected-response.ts";

describe(UnexpectedResponseError, () => {
	it("should set name to UnexpectedResponseError", ({ expect }) => {
		expect.assertions(1);

		const error = new UnexpectedResponseError("Malformed badge response", {
			statusCode: 200,
		});

		expect(error.name).toBe("UnexpectedResponseError");
	});

	it("should be an OpenCloudError but not an ApiError", ({ expect }) => {
		expect.assertions(2);

		const error = new UnexpectedResponseError("Malformed badge response", {
			statusCode: 200,
		});

		expect(error).toBeInstanceOf(OpenCloudError);
		expect(error).not.toBeInstanceOf(ApiError);
	});

	it("should carry the raw response body and status code", ({ expect }) => {
		expect.assertions(3);

		const error = new UnexpectedResponseError("Malformed badge response", {
			details: { id: "not-a-number" },
			statusCode: 200,
		});

		expect(error.message).toBe("Malformed badge response");
		expect(error.details).toStrictEqual({ id: "not-a-number" });
		expect(error.statusCode).toBe(200);
	});

	it("should carry the request context when provided", ({ expect }) => {
		expect.assertions(3);

		const error = new UnexpectedResponseError("Malformed badge response", {
			method: "GET",
			responseHeaders: { "x-request-id": "abc-123" },
			statusCode: 200,
			url: "https://apis.roblox.com/legacy-badges/v1/badges/1",
		});

		expect(error.method).toBe("GET");
		expect(error.url).toBe("https://apis.roblox.com/legacy-badges/v1/badges/1");
		expect(error.responseHeaders).toStrictEqual({ "x-request-id": "abc-123" });
	});

	it("should leave the request context undefined when omitted", ({ expect }) => {
		expect.assertions(4);

		const error = new UnexpectedResponseError("Malformed badge response", {
			statusCode: 200,
		});

		expect(error.details).toBeUndefined();
		expect(error.method).toBeUndefined();
		expect(error.url).toBeUndefined();
		expect(error.responseHeaders).toBeUndefined();
	});

	it("should store cause when provided", ({ expect }) => {
		expect.assertions(1);

		const cause = new SyntaxError("Unexpected token");
		const error = new UnexpectedResponseError("Malformed publish response", {
			cause,
			statusCode: 200,
		});

		expect(error.cause).toBe(cause);
	});
});
