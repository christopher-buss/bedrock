import { describe, expect, it } from "vitest";

import { LIST_LOGS_SPEC } from "#src/domains/cloud-v2/luau-execution-task-logs/specs";
import {
	GET_SPEC,
	SUBMIT_HEAD_SPEC,
	SUBMIT_VERSION_SPEC,
} from "#src/domains/cloud-v2/luau-execution-tasks/specs";
import { perMinuteAllowance } from "./_helpers.ts";

const SECONDS_PER_MINUTE = 60;

const SUBMIT_PINS = [
	["Cloud_CreateLuauExecutionSessionTask__Using_Universes", SUBMIT_HEAD_SPEC.operationLimit],
	[
		"Cloud_CreateLuauExecutionSessionTask__Using_Universes_Places",
		SUBMIT_VERSION_SPEC.operationLimit,
	],
] as const;

const PINS = [
	...SUBMIT_PINS,
	["Cloud_GetLuauExecutionSessionTask", GET_SPEC.operationLimit],
	["Cloud_ListLuauExecutionSessionTaskLogs", LIST_LOGS_SPEC.operationLimit],
] as const;

describe("luau-execution specs are paced by their own operation's declared rate", () => {
	it.for(PINS)("should pace %s at the rate that operation declares", ([operationId, limit]) => {
		expect.assertions(1);

		expect(limit.maxPerSecond).toBe(perMinuteAllowance(operationId) / SECONDS_PER_MINUTE);
	});
});

describe("luau-execution task-create specs grant their operation's declared burst", () => {
	it.for(SUBMIT_PINS)(
		"should grant %s a burst equal to the per-minute allowance that operation declares",
		([operationId, limit]) => {
			expect.assertions(1);

			expect(limit.burstCapacity).toBe(perMinuteAllowance(operationId));
		},
	);
});
