import type { PlaceRestartForecast } from "./types.ts";

/** The requested places that run outdated servers, and their total. */
export interface OutdatedSelection {
	/** Outdated servers across `placeIds`. */
	readonly instancesImpacted: number;
	/** Requested places with at least one outdated server, in request order. */
	readonly placeIds: ReadonlyArray<string>;
}

/**
 * Selects the requested places whose forecast counts outdated servers. A
 * place missing from the forecast has no live server and is skipped. A
 * repeated place ID counts once, at its first position.
 *
 * @param placeIds - The requested place IDs.
 * @param forecasts - The universe's restart forecast.
 * @returns The selected places and their outdated server total.
 */
export function selectOutdatedPlaces(
	placeIds: ReadonlyArray<string>,
	forecasts: ReadonlyArray<PlaceRestartForecast>,
): OutdatedSelection {
	const impacted = new Map(
		forecasts.map((forecast) => [forecast.placeId, forecast.instancesImpacted]),
	);
	const selected: Array<string> = [];
	let instancesImpacted = 0;
	const uniquePlaceIds = new Set(placeIds);
	for (const placeId of uniquePlaceIds) {
		const count = impacted.get(placeId) ?? 0;
		if (count > 0) {
			selected.push(placeId);
			instancesImpacted += count;
		}
	}

	return { instancesImpacted, placeIds: selected };
}
