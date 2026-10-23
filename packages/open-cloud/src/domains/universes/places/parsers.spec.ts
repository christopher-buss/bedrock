import { assert, describe, it } from "vitest";

import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { parsePublishResponse } from "./parsers.ts";

describe(parsePublishResponse, () => {
	it("should return success with the parsed versionNumber for an object body", ({ expect }) => {
		expect.assertions(1);

		const result = parsePublishResponse({
			body: { versionNumber: 42 },
			headers: { "content-type": "application/json" },
			status: 200,
		});

		assert(result.success);

		expect(result.data).toStrictEqual({ versionNumber: 42 });
	});

	it("should accept a stringified JSON body served under text/plain", ({ expect }) => {
		expect.assertions(1);

		const result = parsePublishResponse({
			body: '{"versionNumber":7}',
			headers: { "content-type": "text/plain" },
			status: 200,
		});

		assert(result.success);

		expect(result.data.versionNumber).toBe(7);
	});

	it("should return an UnexpectedResponseError when the string body is not valid JSON", ({
		expect,
	}) => {
		expect.assertions(3);

		const result = parsePublishResponse({
			body: "not-json",
			headers: { "content-type": "text/plain" },
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toBe("Malformed publish response");
		expect(result.err.statusCode).toBe(200);
	});

	it("should carry the raw string body and the parse error when the string body is not valid JSON", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = parsePublishResponse({
			body: "not-json",
			headers: { "content-type": "text/plain" },
			status: 200,
		});

		assert(!result.success);

		expect(result.err.details).toBe("not-json");
		expect(result.err.cause).toBeInstanceOf(SyntaxError);
	});

	it("should carry the offending body on the malformed-response error", ({ expect }) => {
		expect.assertions(1);

		const result = parsePublishResponse({
			body: { unexpected: true },
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err.details).toStrictEqual({ unexpected: true });
	});

	it("should return an UnexpectedResponseError when versionNumber is missing from an object body", ({
		expect,
	}) => {
		expect.assertions(2);

		const result = parsePublishResponse({
			body: {},
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toBe("Malformed publish response");
	});

	it("should return an UnexpectedResponseError when versionNumber is not a number", ({
		expect,
	}) => {
		expect.assertions(1);

		const result = parsePublishResponse({
			body: { versionNumber: "42" },
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
	});

	it("should return an UnexpectedResponseError when the body is an array", ({ expect }) => {
		expect.assertions(1);

		const result = parsePublishResponse({
			body: [{ versionNumber: 1 }],
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
	});

	it("should reject an array body even when it carries a versionNumber property", ({
		expect,
	}) => {
		expect.assertions(1);

		// An array with `versionNumber` set as a property still has the
		// JS class tag `[object Array]`, so the record discriminator
		// rejects it before the field check.
		const arrayWithProperty = Object.assign([0], { versionNumber: 42 });
		const result = parsePublishResponse({
			body: arrayWithProperty,
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
	});

	it("should propagate the response status code on the returned UnexpectedResponseError", ({
		expect,
	}) => {
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
