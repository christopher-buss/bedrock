import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseBinaryInputResponse } from "./parsers.ts";

function validBody(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		path: "universes/123/luau-execution-session-task-binary-inputs/abc",
		uploadUri: "https://storage.example.com/upload?token=xyz",
		...overrides,
	};
}

describe(parseBinaryInputResponse, () => {
	it("should parse a wire body with path and uploadUri into a LuauExecutionTaskBinaryInput", () => {
		expect.assertions(2);

		const result = parseBinaryInputResponse({
			body: validBody(),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.path).toBe(
			"universes/123/luau-execution-session-task-binary-inputs/abc",
		);
		expect(result.data.uploadUri).toBe("https://storage.example.com/upload?token=xyz");
	});

	describe("malformed bodies", () => {
		it("should reject a non-record body", () => {
			expect.assertions(2);

			const result = parseBinaryInputResponse({
				body: "not an object",
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.statusCode).toBe(200);
		});

		it("should reject a body missing the path field", () => {
			expect.assertions(1);

			const { path: _removed, ...rest } = validBody();
			const result = parseBinaryInputResponse({ body: rest, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body missing the uploadUri field", () => {
			expect.assertions(1);

			const { uploadUri: _removed, ...rest } = validBody();
			const result = parseBinaryInputResponse({ body: rest, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose path is not a string", () => {
			expect.assertions(1);

			const result = parseBinaryInputResponse({
				body: validBody({ path: 123 }),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose uploadUri is not a string", () => {
			expect.assertions(1);

			const result = parseBinaryInputResponse({
				body: validBody({ uploadUri: 123 }),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose path does not match the expected pattern", () => {
			expect.assertions(1);

			const result = parseBinaryInputResponse({
				body: validBody({ path: "not-a-valid-path" }),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose path is a non-string with a matching toString", () => {
			expect.assertions(1);

			const body = validBody({
				path: {
					toString: (): string =>
						"universes/123/luau-execution-session-task-binary-inputs/abc",
				},
			});
			const result = parseBinaryInputResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should propagate the response status code on the returned ApiError", () => {
			expect.assertions(1);

			const result = parseBinaryInputResponse({
				body: "nope",
				headers: {},
				status: 502,
			});

			assert(!result.success);

			expect(result.err.statusCode).toBe(502);
		});
	});
});
