import { describe, it } from "vitest";

import { selectOutdatedPlaces, summarizeOutdatedRestart } from "./select-outdated.ts";
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

	it("should count a place missing from the forecast as 0", ({ expect }) => {
		expect.assertions(1);

		const selection = selectOutdatedPlaces(["1", "2"], [forecastFor("2", 1)]);

		expect(selection).toStrictEqual({
			placeIds: ["2"],
			places: [
				{ instancesImpacted: 0, placeId: "1" },
				{ instancesImpacted: 1, placeId: "2" },
			],
		});
	});

	it("should keep request order, not forecast order", ({ expect }) => {
		expect.assertions(2);

		const selection = selectOutdatedPlaces(
			["2", "1"],
			[forecastFor("1", 1), forecastFor("2", 1)],
		);

		expect(selection.placeIds).toStrictEqual(["2", "1"]);
		expect(selection.places.map(({ placeId }) => placeId)).toStrictEqual(["2", "1"]);
	});

	it("should ignore repeated place IDs", ({ expect }) => {
		expect.assertions(1);

		const selection = selectOutdatedPlaces(
			["1", "2", "1"],
			[forecastFor("1", 2), forecastFor("2", 3)],
		);

		expect(selection).toStrictEqual({
			placeIds: ["1", "2"],
			places: [
				{ instancesImpacted: 2, placeId: "1" },
				{ instancesImpacted: 3, placeId: "2" },
			],
		});
	});
});

describe(summarizeOutdatedRestart, () => {
	const selection = selectOutdatedPlaces(["1", "2"], [forecastFor("1", 2), forecastFor("2", 0)]);

	it("should mark only the outdated places restarted after a restart", ({ expect }) => {
		expect.assertions(1);

		expect(summarizeOutdatedRestart(selection, true)).toStrictEqual({
			places: [
				{ instancesImpacted: 2, placeId: "1", restarted: true },
				{ instancesImpacted: 0, placeId: "2", restarted: false },
			],
			restarted: true,
		});
	});

	it("should mark no place restarted when no restart was sent", ({ expect }) => {
		expect.assertions(1);

		expect(summarizeOutdatedRestart(selection, false)).toStrictEqual({
			places: [
				{ instancesImpacted: 2, placeId: "1", restarted: false },
				{ instancesImpacted: 0, placeId: "2", restarted: false },
			],
			restarted: false,
		});
	});
});
