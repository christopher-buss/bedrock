import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseForecastResponse } from "./parsers.ts";

// Captured 2026-10-25 against apis.roblox.com/server-management/v1/universes/
// {universeId}/restarts:forecast with a maintainer key and the test universe.
// The forecast reported no live players. The body contains no identifying
// values and is preserved as received, apart from JSON whitespace.

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
