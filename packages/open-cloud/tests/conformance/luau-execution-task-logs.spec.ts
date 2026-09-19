import { assert, describe, expect, it } from "vitest";

import { parseListLogsResponse } from "#src/domains/cloud-v2/luau-execution-task-logs/parsers";
import { schemaEnum } from "./_helpers.ts";

describe("declared enum conformance", () => {
	it.for(schemaEnum("LuauExecutionSessionTaskLog_LogMessage", "messageType"))(
		"should accept the schema-declared log message type %s",
		(messageType) => {
			expect.assertions(1);

			const result = parseListLogsResponse({
				body: {
					luauExecutionSessionTaskLogs: [
						{
							structuredMessages: [
								{
									createTime: "2026-01-01T00:00:00Z",
									message: "hello",
									messageType,
								},
							],
						},
					],
				},
				headers: {},
				status: 200,
			});

			assert(result.success);

			expect(result.data.messages[0]!.messageType).toBe(messageType);
		},
	);
});
