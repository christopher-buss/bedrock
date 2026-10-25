import { LuauExecutionClient } from "@bedrock-rbx/ocale/luau-execution";

import process from "node:process";
import { assert, describe, it } from "vitest";

import { assertOk } from "../helpers/assert-ok.ts";

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];
const PLACE_ID = process.env["ROBLOX_TEST_PLACE_ID"];

const HAS_SECRETS = API_KEY !== undefined && UNIVERSE_ID !== undefined && PLACE_ID !== undefined;

const TASK_TIMEOUT_MS = 120_000;
const LOG_TIMEOUT_MS = 30_000;

describe("luau execution via real Roblox", () => {
	it.skipIf(!HAS_SECRETS)(
		"should complete a script with the expected output and printed log line",
		async ({ expect }) => {
			expect.assertions(3);

			assert(API_KEY !== undefined, "BEDROCK_API_KEY must be set");
			assert(UNIVERSE_ID !== undefined, "ROBLOX_TEST_UNIVERSE_ID must be set");
			assert(PLACE_ID !== undefined, "ROBLOX_TEST_PLACE_ID must be set");

			const client = new LuauExecutionClient({
				credential: { apiKey: API_KEY, kind: "apiKey" },
			});

			// One submit (5/min), the helper's default polling cadence (below
			// 200 reads/min), and one log read (45/min) use the pinned SDK
			// limits.
			const completed = await client.tasks.runUntilDone(
				{
					placeId: PLACE_ID,
					script: 'print("bedrock luau smoke log")\nreturn "bedrock luau smoke output"',
					timeoutSeconds: 30,
					universeId: UNIVERSE_ID,
				},
				{ timeoutMs: TASK_TIMEOUT_MS },
			);
			assertOk(completed, "Luau execution submit and poll");

			expect(completed.data.state).toBe("COMPLETE");

			assert(completed.data.state === "COMPLETE");

			expect(completed.data.output.results).toStrictEqual(["bedrock luau smoke output"]);

			const logs = await client.tasks.listLogs(
				{ ref: completed.data.ref },
				{ deadlineMs: Date.now() + LOG_TIMEOUT_MS },
			);
			assertOk(logs, "Luau execution list logs");

			expect(logs.data.messages.map((message) => message.message)).toContain(
				"bedrock luau smoke log",
			);
		},
		180_000,
	);
});
