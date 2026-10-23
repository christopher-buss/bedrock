import type { Except } from "type-fest";

import type { OutdatedRestart, PlaceOutdatedRestart, PlaceRestartForecast } from "./types.ts";

/** The requested places, their outdated servers, and those to restart. */
export interface OutdatedSelection {
	/** Requested places with at least one outdated server, in request order. */
	readonly placeIds: ReadonlyArray<string>;
	/** One entry per requested place (duplicates removed), in request order. */
	readonly places: ReadonlyArray<Except<PlaceOutdatedRestart, "restarted">>;
}

/**
 * Selects the requested places whose forecast counts outdated servers. A
 * place missing from the forecast has no live server and counts 0. A
 * repeated place ID counts once, at its first position.
 *
 * @param placeIds - The requested place IDs.
 * @param forecasts - The universe's restart forecast.
 * @returns Each requested place with its outdated server count, and the
 *   places to restart.
 */
export function selectOutdatedPlaces(
	placeIds: ReadonlyArray<string>,
	forecasts: ReadonlyArray<PlaceRestartForecast>,
): OutdatedSelection {
	const impacted = new Map(
		forecasts.map((forecast) => [forecast.placeId, forecast.instancesImpacted]),
	);
	const places = Array.from(new Set(placeIds), (placeId) => {
		return { instancesImpacted: impacted.get(placeId) ?? 0, placeId };
	});

	return {
		placeIds: places
			.filter(({ instancesImpacted }) => instancesImpacted > 0)
			.map(({ placeId }) => placeId),
		places,
	};
}

/**
 * Builds the per-place outcome of a restart of `selection.placeIds`.
 *
 * @param selection - The selection that drove the final decision.
 * @param restarted - Whether the restart call for the selection succeeded.
 * @returns The outcome, with only the selected places marked restarted.
 */
export function summarizeOutdatedRestart(
	selection: OutdatedSelection,
	restarted: boolean,
): OutdatedRestart {
	return {
		places: selection.places.map((place) => {
			return { ...place, restarted: restarted && place.instancesImpacted > 0 };
		}),
		restarted,
	};
}
