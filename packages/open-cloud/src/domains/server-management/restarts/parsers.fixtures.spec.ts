import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseForecastResponse, parseLaunchResponse } from "./parsers.ts";

// Captured 2026-10-25 from GET .../restarts:forecast and POST .../restarts at
// apis.roblox.com/server-management/v1/universes/{universeId}, using a maintainer
// key and the test universe. The forecast was checked twice for zero live
// players before launch. These bodies contain no identifying values and are
// preserved as received apart from JSON whitespace. The nil restart UUID is a
// protocol sentinel, retained so the parser's no-op normalization is exercised.

describe(parseForecastResponse, () => {
	it("should parse a captured forecast with no live servers into no place forecasts", ({
		expect,
	}) => {
		expect.assertions(1);

		const body = loadFixture("universes", "restart-forecast-response.json");

		const result = parseForecastResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual([]);
	});
});

describe(parseLaunchResponse, () => {
	it("should parse a captured launch that matched no servers into an undefined restart id", ({
		expect,
	}) => {
		expect.assertions(1);

		const body = loadFixture("universes", "restart-launch-response.json");

		const result = parseLaunchResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: undefined,
			instancesImpacted: 0,
			playersImpacted: 0,
		});
	});
});
