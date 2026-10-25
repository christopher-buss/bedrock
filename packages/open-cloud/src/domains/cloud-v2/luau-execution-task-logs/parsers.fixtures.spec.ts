import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseListLogsResponse } from "./parsers.ts";

// Captured 2026-10-25 from GET /cloud/v2/{task.path}/logs?view=STRUCTURED
// at apis.roblox.com after a task ran print("bedrock-luau-fixture"); return 1.
// Universe/place/version/session/task ids were replaced with stable fakes;
// field presence, nesting, types, message text and timestamp are verbatim.
// The final page omits nextPageToken and includes no FLAT-mode messages.

describe(parseListLogsResponse, () => {
	it("should parse a captured STRUCTURED logs page into the printed message", ({ expect }) => {
		expect.assertions(1);

		const body = loadFixture("luau-execution-task-logs", "list-response.json");

		const result = parseListLogsResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			messages: [
				{
					createTime: "2026-10-25T02:08:12.993Z",
					message: "bedrock-luau-fixture",
					messageType: "OUTPUT",
				},
			],
			nextPageToken: undefined,
		});
	});
});
