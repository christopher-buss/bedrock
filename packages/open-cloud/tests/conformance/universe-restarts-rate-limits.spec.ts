import { describe, expect, it } from "vitest";

import { RESTART_OPERATION_LIMIT } from "#src/domains/cloud-v2/universes/operations";
import {
	FORECAST_OPERATION_LIMIT,
	LAUNCH_OPERATION_LIMIT,
	LIST_OPERATION_LIMIT,
} from "#src/domains/server-management/restarts/operations";
import { perMinuteAllowance } from "./_helpers.ts";

const SECONDS_PER_MINUTE = 60;

const PINS = [
	["Cloud_RestartUniverseServers", RESTART_OPERATION_LIMIT],
	["Restarts_ForecastRestart", FORECAST_OPERATION_LIMIT],
	["Restarts_LaunchRestart", LAUNCH_OPERATION_LIMIT],
	["Restarts_ListRestartStatuses", LIST_OPERATION_LIMIT],
] as const;

describe("universe restart specs are paced by their own operation's declared rate", () => {
	it.for(PINS)("should pace %s at the rate that operation declares", ([operationId, limit]) => {
		expect.assertions(1);

		expect(limit.maxPerSecond).toBe(perMinuteAllowance(operationId) / SECONDS_PER_MINUTE);
	});
});

describe("sub-second universe restart specs grant their operation's declared burst", () => {
	it("should grant Cloud_RestartUniverseServers a burst equal to its per-minute allowance", () => {
		expect.assertions(1);

		expect(RESTART_OPERATION_LIMIT.burstCapacity).toBe(
			perMinuteAllowance("Cloud_RestartUniverseServers"),
		);
	});
});
