/**
 * Builds a `PlaceSummaryForGameRestart` wire body as captured live from
 * a universe with one player on one server. Overrides may carry values
 * the wire type forbids, so malformed-response tests can reuse it.
 *
 * @param overrides - Fields to override on the default body.
 * @returns The wire body with the overrides applied.
 */
export function placeForecastWire(
	overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		instancesImpacted: 0,
		instancesPerVersion: { 6: 1 },
		isNotInUniverse: false,
		latestPlaceVersion: "6",
		playersImpacted: 0,
		playersPerVersion: { 6: 1 },
		publishTime: "2026-04-24T02:36:28.673Z",
		totalInstances: 1,
		totalPlayers: 1,
		...overrides,
	};
}

/**
 * Builds a `PlaceRestartStatus` wire body as captured live while a
 * restart of one server was still in its bleed-off period. Overrides may
 * carry values the wire type forbids.
 *
 * @param overrides - Fields to override on the default body.
 * @returns The wire body with the overrides applied.
 */
export function placeRestartStatusWire(
	overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		endTime: JSON.parse("null"),
		filter: { excludeCurrentVersion: JSON.parse("null"), versions: [6] },
		latestVersion: "6",
		remainingInstances: 1,
		remainingPlayers: 1,
		startTime: "2026-09-23T17:21:39.2972534Z",
		state: "DELAYING",
		totalInstances: 1,
		totalPlayers: 1,
		...overrides,
	};
}

/**
 * Wraps place statuses in a `RestartStatus` wire body for universe 42.
 *
 * @param placeRestartStatuses - Place statuses keyed by place ID; any
 *   value, so malformed-response tests can reuse it.
 * @returns The wire body.
 */
export function restartStatusWire(placeRestartStatuses: unknown): Record<string, unknown> {
	return {
		placeRestartStatuses,
		scheduledTime: "2026-09-23T17:21:39.2972534Z",
		startTime: "2026-09-23T17:22:39.2972534Z",
		universeId: "42",
	};
}
