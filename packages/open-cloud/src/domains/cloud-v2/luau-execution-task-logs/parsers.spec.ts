import { validLogPageBody } from "#tests/helpers/luau-execution-task-logs";
import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseListLogsResponse } from "./parsers.ts";

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
			body: {
				luauExecutionSessionTaskLogs: [
					{
						structuredMessages: [
							{
								createTime: "2026-01-01T00:00:00Z",
								message: "x",
								messageType: "MESSAGE_TYPE_UNSPECIFIED",
							},
						],
					},
				],
			},
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

	it("should treat a body that omits luauExecutionSessionTaskLogs as an empty page", () => {
		expect.assertions(1);

		const result = parseListLogsResponse({ body: {}, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.messages).toStrictEqual([]);
	});

	it("should treat a body whose luauExecutionSessionTaskLogs is explicitly null as an empty page", () => {
		expect.assertions(1);

		const body: Record<string, unknown> = {
			luauExecutionSessionTaskLogs: JSON.parse("null"),
		};

		const result = parseListLogsResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.messages).toStrictEqual([]);
	});

	it("should normalize a JSON null nextPageToken to undefined", () => {
		expect.assertions(1);

		const body: Record<string, unknown> = {
			luauExecutionSessionTaskLogs: [],
			nextPageToken: JSON.parse("null"),
		};

		const result = parseListLogsResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data.nextPageToken).toBeUndefined();
	});

	it("should skip a chunk whose structuredMessages field is omitted", () => {
		expect.assertions(1);

		const result = parseListLogsResponse({
			body: { luauExecutionSessionTaskLogs: [{}] },
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.messages).toStrictEqual([]);
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
					luauExecutionSessionTaskLogs: [{ structuredMessages: "not-an-array" }],
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
						luauExecutionSessionTaskLogs: [{ structuredMessages: [badMessage] }],
					},
					headers: {},
					status: 200,
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
			},
		);

		it("should reject the whole page when any message in a chunk is invalid", () => {
			expect.assertions(1);

			const result = parseListLogsResponse({
				body: {
					luauExecutionSessionTaskLogs: [
						{
							structuredMessages: [
								{
									createTime: "2026-01-01T00:00:00Z",
									message: "valid",
									messageType: "OUTPUT",
								},
								{ createTime: "2026-01-01T00:00:01Z", messageType: "OUTPUT" },
							],
						},
					],
				},
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

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
