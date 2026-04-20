import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../errors/api-error.ts";
import { parsePublishResponse } from "./parsers.ts";

describe(parsePublishResponse, () => {
	it("should return success with the parsed versionNumber for an object body", () => {
		expect.assertions(1);

		const result = parsePublishResponse({
			body: { versionNumber: 42 },
			headers: { "content-type": "application/json" },
			status: 200,
		});

		assert(result.success);

		expect(result.data).toStrictEqual({ versionNumber: 42 });
	});

	it("should accept a stringified JSON body served under text/plain", () => {
		expect.assertions(1);

		const result = parsePublishResponse({
			body: '{"versionNumber":7}',
			headers: { "content-type": "text/plain" },
			status: 200,
		});

		assert(result.success);

		expect(result.data.versionNumber).toBe(7);
	});

	it("should return an ApiError when the string body is not valid JSON", () => {
		expect.assertions(3);

		const result = parsePublishResponse({
			body: "not-json",
			headers: { "content-type": "text/plain" },
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed publish response");
		expect(result.err.statusCode).toBe(200);
	});

	it("should return an ApiError when versionNumber is missing from an object body", () => {
		expect.assertions(2);

		const result = parsePublishResponse({
			body: {},
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed publish response");
	});

	it("should return an ApiError when versionNumber is not a number", () => {
		expect.assertions(1);

		const result = parsePublishResponse({
			body: { versionNumber: "42" },
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should return an ApiError when the body is an array", () => {
		expect.assertions(1);

		const result = parsePublishResponse({
			body: [{ versionNumber: 1 }],
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should propagate the response status code on the returned ApiError", () => {
		expect.assertions(1);

		const result = parsePublishResponse({
			body: 123,
			headers: {},
			status: 201,
		});

		assert(!result.success);

		expect(result.err.statusCode).toBe(201);
	});
});
