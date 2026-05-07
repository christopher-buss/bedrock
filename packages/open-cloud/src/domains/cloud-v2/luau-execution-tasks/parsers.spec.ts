import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseLuauExecutionTaskResponse } from "./parsers.ts";

function validInProgressBody(
	overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		createTime: "2026-01-01T00:00:00Z",
		path: "universes/123/places/456/luau-execution-session-tasks/task-1",
		state: "QUEUED",
		updateTime: "2026-01-01T00:00:30Z",
		user: "user-1",
		...overrides,
	};
}

const REQUIRED_STRING_FIELDS = ["path", "createTime", "updateTime", "state", "user"] as const;

describe(parseLuauExecutionTaskResponse, () => {
	it.for(["QUEUED", "PROCESSING", "CANCELLED"] as const)(
		"should parse %s wire state into an in-progress LuauExecutionTask",
		(state) => {
			expect.assertions(5);

			const result = parseLuauExecutionTaskResponse({
				body: validInProgressBody({ state }),
				headers: {},
				status: 200,
			});

			assert(result.success);

			expect(result.data.state).toBe(state);
			expect(result.data.ref).toStrictEqual({
				placeId: "456",
				sessionId: undefined,
				taskId: "task-1",
				universeId: "123",
				versionId: undefined,
			});
			expect(result.data.createdAt).toStrictEqual(new Date("2026-01-01T00:00:00Z"));
			expect(result.data.updatedAt).toStrictEqual(new Date("2026-01-01T00:00:30Z"));
			expect(result.data.user).toBe("user-1");
		},
	);

	describe("with state COMPLETE", () => {
		it("should parse a COMPLETE state with output.results into a CompleteTask", () => {
			expect.assertions(2);

			const result = parseLuauExecutionTaskResponse({
				body: validInProgressBody({
					output: { results: ["hello", 42, true] },
					state: "COMPLETE",
				}),
				headers: {},
				status: 200,
			});

			assert(result.success);
			assert(result.data.state === "COMPLETE");

			expect(result.data.state).toBe("COMPLETE");
			expect(result.data.output.results).toStrictEqual(["hello", 42, true]);
		});

		it("should reject a COMPLETE response that is missing the output field", () => {
			expect.assertions(1);

			const result = parseLuauExecutionTaskResponse({
				body: validInProgressBody({ state: "COMPLETE" }),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a COMPLETE response whose output.results is not an array", () => {
			expect.assertions(1);

			const result = parseLuauExecutionTaskResponse({
				body: validInProgressBody({
					output: { results: "not-an-array" },
					state: "COMPLETE",
				}),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a COMPLETE response whose output is not a record", () => {
			expect.assertions(1);

			const result = parseLuauExecutionTaskResponse({
				body: validInProgressBody({ output: 123, state: "COMPLETE" }),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});
	});

	describe("with state FAILED", () => {
		it.for([
			"DEADLINE_EXCEEDED",
			"INTERNAL_ERROR",
			"OUTPUT_SIZE_LIMIT_EXCEEDED",
			"SCRIPT_ERROR",
		] as const)("should parse a FAILED task whose error.code is %s", (code) => {
			expect.assertions(3);

			const result = parseLuauExecutionTaskResponse({
				body: validInProgressBody({
					error: { code, message: "the script blew up" },
					state: "FAILED",
				}),
				headers: {},
				status: 200,
			});

			assert(result.success);
			assert(result.data.state === "FAILED");

			expect(result.data.state).toBe("FAILED");
			expect(result.data.error.code).toBe(code);
			expect(result.data.error.message).toBe("the script blew up");
		});

		it("should reject a FAILED response that is missing the error field", () => {
			expect.assertions(1);

			const result = parseLuauExecutionTaskResponse({
				body: validInProgressBody({ state: "FAILED" }),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a FAILED response whose error.code is not one of the supported codes", () => {
			expect.assertions(1);

			const result = parseLuauExecutionTaskResponse({
				body: validInProgressBody({
					error: { code: "BOGUS", message: "x" },
					state: "FAILED",
				}),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a FAILED response whose error.message is not a string", () => {
			expect.assertions(1);

			const result = parseLuauExecutionTaskResponse({
				body: validInProgressBody({
					error: { code: "SCRIPT_ERROR", message: 42 },
					state: "FAILED",
				}),
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});
	});

	it("should return ApiError when the wire state is STATE_UNSPECIFIED", () => {
		expect.assertions(2);

		const result = parseLuauExecutionTaskResponse({
			body: validInProgressBody({ state: "STATE_UNSPECIFIED" }),
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toContain("Malformed");
	});

	it("should return ApiError when the path does not match a supported x-aep-resource format", () => {
		expect.assertions(1);

		const result = parseLuauExecutionTaskResponse({
			body: validInProgressBody({ path: "not-a-valid-path" }),
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	describe("malformed bodies", () => {
		it("should reject a non-record body", () => {
			expect.assertions(2);

			const result = parseLuauExecutionTaskResponse({
				body: "not an object",
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.statusCode).toBe(200);
		});

		it.for(REQUIRED_STRING_FIELDS)(
			"should reject a body missing the required %s field",
			(field) => {
				expect.assertions(1);

				const { [field]: _removed, ...rest } = validInProgressBody();
				const result = parseLuauExecutionTaskResponse({
					body: rest,
					headers: {},
					status: 200,
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
			},
		);

		it.for(REQUIRED_STRING_FIELDS)(
			"should reject a body whose required %s field is not a string",
			(field) => {
				expect.assertions(1);

				const result = parseLuauExecutionTaskResponse({
					body: validInProgressBody({ [field]: 123 }),
					headers: {},
					status: 200,
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
			},
		);

		it("should reject a body whose path is a non-string with a matching toString", () => {
			expect.assertions(1);

			const body = validInProgressBody({
				path: {
					toString: (): string =>
						"universes/123/places/456/luau-execution-session-tasks/task-1",
				},
			});
			const result = parseLuauExecutionTaskResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should propagate the response status code on the returned ApiError", () => {
			expect.assertions(1);

			const result = parseLuauExecutionTaskResponse({
				body: "nope",
				headers: {},
				status: 502,
			});

			assert(!result.success);

			expect(result.err.statusCode).toBe(502);
		});
	});
});
