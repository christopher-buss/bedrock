import { assert, describe, it } from "vitest";

import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { parseBinaryInputResponse } from "./parsers.ts";

function validBody(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		path: "universes/123/luau-execution-session-task-binary-inputs/abc",
		uploadUri: "https://storage.example.com/upload?token=xyz",
		...overrides,
	};
}

describe(parseBinaryInputResponse, () => {
	it("should parse a wire body with path and uploadUri into a LuauExecutionTaskBinaryInput", ({
		expect,
	}) => {
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
		it("should reject a non-record body", ({ expect }) => {
			expect.assertions(2);

			const result = parseBinaryInputResponse({
				body: "not an object",
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(UnexpectedResponseError);
			expect(result.err.statusCode).toBe(200);
		});

		it("should carry the offending body on the malformed-response error", ({ expect }) => {
			expect.assertions(1);

			const result = parseBinaryInputResponse({
				body: { unexpected: true },
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err.details).toStrictEqual({ unexpected: true });
		});

		it("should reject a body missing the path field", ({ expect }) => {
			expect.assertions(1);

			const { path: _removed, ...rest } = validBody();
			const result = parseBinaryInputResponse({ body: rest, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		});

		it("should reject a body missing the uploadUri field", ({ expect }) => {
			expect.assertions(1);

			const { uploadUri: _removed, ...rest } = validBody();
			const result = parseBinaryInputResponse({ body: rest, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		});

		it("should reject a body whose path is not a string", ({ expect }) => {
			expect.assertions(1);

			const result = parseBinaryInputResponse({
				body: validBody({ path: 123 }),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		});

		it("should reject a body whose uploadUri is not a string", ({ expect }) => {
			expect.assertions(1);

			const result = parseBinaryInputResponse({
				body: validBody({ uploadUri: 123 }),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		});

		it("should reject a body whose path does not match the expected pattern", ({ expect }) => {
			expect.assertions(1);

			const result = parseBinaryInputResponse({
				body: validBody({ path: "not-a-valid-path" }),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		});

		it("should reject a body whose path is a non-string with a matching toString", ({
			expect,
		}) => {
			expect.assertions(1);

			const body = validBody({
				path: {
					toString: (): string => {
						return "universes/123/luau-execution-session-task-binary-inputs/abc";
					},
				},
			});
			const result = parseBinaryInputResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		});

		it("should propagate the response status code on the returned UnexpectedResponseError", ({
			expect,
		}) => {
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
