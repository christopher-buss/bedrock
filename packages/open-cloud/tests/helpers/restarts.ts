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
