import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseListLogsResponse } from "./parsers.ts";

function validLogPageBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		luauExecutionSessionTaskLogs: [
			{
				path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1/logs/chunk-1",
				structuredMessages: [
					{
						createTime: "2026-01-01T00:00:00Z",
						message: "Hello from Luau",
						messageType: "OUTPUT",
					},
				],
			},
		],
		...overrides,
	};
}

describe(parseListLogsResponse, () => {
	it("should parse an empty page (no chunks, no nextPageToken) into messages: [] and nextPageToken: undefined", () => {
		expect.assertions(2);

		const result = parseListLogsResponse({
			body: { luauExecutionSessionTaskLogs: [] },
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.messages).toStrictEqual([]);
		expect(result.data.nextPageToken).toBeUndefined();
	});

	it("should map a single STRUCTURED message in a single chunk to a single LogMessage", () => {
		expect.assertions(3);

		const result = parseListLogsResponse({
			body: validLogPageBody(),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.messages).toHaveLength(1);
		expect(result.data.messages[0]?.message).toBe("Hello from Luau");
		expect(result.data.messages[0]?.createTime).toBe("2026-01-01T00:00:00Z");
	});

	it("should reject a body whose message contains the MESSAGE_TYPE_UNSPECIFIED sentinel", () => {
		expect.assertions(2);

		const result = parseListLogsResponse({
			body: validLogPageBody({
				luauExecutionSessionTaskLogs: [
					{
						path: "chunk-path",
						structuredMessages: [
							{
								createTime: "2026-01-01T00:00:00Z",
								message: "x",
								messageType: "MESSAGE_TYPE_UNSPECIFIED",
							},
						],
					},
				],
			}),
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toContain("Malformed");
	});

	it("should flatten multiple chunks into a single messages array preserving server-batch order", () => {
		expect.assertions(4);

		const result = parseListLogsResponse({
			body: {
				luauExecutionSessionTaskLogs: [
					{
						path: "chunk-0",
						structuredMessages: [
							{
								createTime: "2026-01-01T00:00:00Z",
								message: "chunk0-msg0",
								messageType: "OUTPUT",
							},
							{
								createTime: "2026-01-01T00:00:01Z",
								message: "chunk0-msg1",
								messageType: "INFO",
							},
						],
					},
					{
						path: "chunk-1",
						structuredMessages: [
							{
								createTime: "2026-01-01T00:00:02Z",
								message: "chunk1-msg0",
								messageType: "WARNING",
							},
							{
								createTime: "2026-01-01T00:00:03Z",
								message: "chunk1-msg1",
								messageType: "ERROR",
							},
						],
					},
				],
			},
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.messages).toHaveLength(4);
		expect(result.data.messages[0]?.message).toBe("chunk0-msg0");
		expect(result.data.messages[2]?.message).toBe("chunk1-msg0");
		expect(result.data.messages[3]?.message).toBe("chunk1-msg1");
	});

	it("should surface nextPageToken when the body sets it", () => {
		expect.assertions(1);

		const result = parseListLogsResponse({
			body: validLogPageBody({ nextPageToken: "tok-2" }),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.nextPageToken).toBe("tok-2");
	});

	it("should surface nextPageToken as undefined when the body omits it", () => {
		expect.assertions(1);

		const result = parseListLogsResponse({
			body: { luauExecutionSessionTaskLogs: [] },
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.nextPageToken).toBeUndefined();
	});

	describe("malformed bodies", () => {
		it("should reject a non-record body", () => {
			expect.assertions(2);

			const result = parseListLogsResponse({
				body: "not an object",
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.statusCode).toBe(200);
		});

		it("should reject a body whose luauExecutionSessionTaskLogs is not an array", () => {
			expect.assertions(1);

			const result = parseListLogsResponse({
				body: { luauExecutionSessionTaskLogs: "not-an-array" },
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose nextPageToken is not a string", () => {
			expect.assertions(1);

			const result = parseListLogsResponse({
				body: { luauExecutionSessionTaskLogs: [], nextPageToken: 42 },
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a chunk that is not a record", () => {
			expect.assertions(1);

			const result = parseListLogsResponse({
				body: { luauExecutionSessionTaskLogs: ["not-a-record"] },
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a chunk whose structuredMessages is not an array", () => {
			expect.assertions(1);

			const result = parseListLogsResponse({
				body: {
					luauExecutionSessionTaskLogs: [
						{ path: "chunk-path", structuredMessages: "not-an-array" },
					],
				},
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it.for([
			{ createTime: 123, message: "x", messageType: "OUTPUT" },
			{ message: "x", messageType: "OUTPUT" },
			{ createTime: "2026-01-01T00:00:00Z", messageType: "OUTPUT" },
			{ createTime: "2026-01-01T00:00:00Z", message: 42, messageType: "OUTPUT" },
		] as const)(
			"should reject a message whose required createTime/message fields are missing or non-string",
			(badMessage) => {
				expect.assertions(1);

				const result = parseListLogsResponse({
					body: {
						luauExecutionSessionTaskLogs: [
							{ path: "chunk-path", structuredMessages: [badMessage] },
						],
					},
					headers: {},
					status: 200,
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
			},
		);

		it("should propagate the response status code on the returned ApiError", () => {
			expect.assertions(1);

			const result = parseListLogsResponse({
				body: "nope",
				headers: {},
				status: 502,
			});

			assert(!result.success);

			expect(result.err.statusCode).toBe(502);
		});
	});
});
