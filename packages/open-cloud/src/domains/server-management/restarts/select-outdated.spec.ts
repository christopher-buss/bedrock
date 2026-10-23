import { describe, it } from "vitest";

import { selectOutdatedPlaces } from "./select-outdated.ts";
import type { PlaceRestartForecast } from "./types.ts";

function forecastFor(placeId: string, instancesImpacted: number): PlaceRestartForecast {
	return {
		instancesImpacted,
		instancesPerVersion: {},
		isNotInUniverse: false,
		latestPlaceVersion: "1",
		placeId,
		playersImpacted: 0,
		playersPerVersion: {},
		publishedAt: new Date(0),
		totalInstances: instancesImpacted,
		totalPlayers: 0,
	};
}

describe(selectOutdatedPlaces, () => {
	it("should select only places with outdated servers", ({ expect }) => {
		expect.assertions(1);

		const selection = selectOutdatedPlaces(
			["1", "2"],
			[forecastFor("1", 0), forecastFor("2", 3)],
		);

		expect(selection.placeIds).toStrictEqual(["2"]);
	});

	it("should skip a place missing from the forecast", ({ expect }) => {
		expect.assertions(1);

		const selection = selectOutdatedPlaces(["1", "2"], [forecastFor("2", 1)]);

		expect(selection).toStrictEqual({ instancesImpacted: 1, placeIds: ["2"] });
	});

	it("should sum outdated servers across selected places", ({ expect }) => {
		expect.assertions(1);

		const selection = selectOutdatedPlaces(
			["1", "2"],
			[forecastFor("1", 2), forecastFor("2", 3)],
		);

		expect(selection.instancesImpacted).toBe(5);
	});

	it("should keep request order, not forecast order", ({ expect }) => {
		expect.assertions(1);

		const selection = selectOutdatedPlaces(
			["2", "1"],
			[forecastFor("1", 1), forecastFor("2", 1)],
		);

		expect(selection.placeIds).toStrictEqual(["2", "1"]);
	});

	it("should ignore repeated place IDs", ({ expect }) => {
		expect.assertions(1);

		const selection = selectOutdatedPlaces(
			["1", "2", "1"],
			[forecastFor("1", 2), forecastFor("2", 3)],
		);

		expect(selection).toStrictEqual({ instancesImpacted: 5, placeIds: ["1", "2"] });
	});
});
