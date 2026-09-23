// Mirrors the server-management restart schemas from
// vendor/roblox-openapi.json. Internal to the subpath -- not re-exported
// from index.ts.
//
// Nullable OpenAPI fields are modelled as `T | undefined` to comply with
// `unicorn/no-null`; the parser normalizes JSON `null` at the boundary.

/**
 * Wire shape of `PlaceSummaryForGameRestart`.
 */
export interface PlaceSummaryForGameRestartWire {
	/** Servers a restart of old versions would close. */
	readonly instancesImpacted: number;
	/** Server count keyed by place version; nullable. */
	readonly instancesPerVersion: Readonly<Record<string, number>> | undefined;
	/** Whether the place has moved to another universe. */
	readonly isNotInUniverse: boolean;
	/** Latest place version on any live server; nullable. */
	readonly latestPlaceVersion: string | undefined;
	/** Players a restart of old versions would move. */
	readonly playersImpacted: number;
	/** Player count keyed by place version; nullable. */
	readonly playersPerVersion: Readonly<Record<string, number>> | undefined;
	/** When the latest place version was published. */
	readonly publishTime: string;
	/** Live servers of the place. */
	readonly totalInstances: number;
	/** Players in the place. */
	readonly totalPlayers: number;
}

/**
 * Wire shape of `ForecastRestartResponse`.
 */
export interface ForecastRestartResponseWire {
	/** Per-place forecast keyed by place ID; nullable. */
	readonly placeForecasts: Readonly<Record<string, PlaceSummaryForGameRestartWire>> | undefined;
}

/**
 * Wire shape of `LaunchRestartResponse`.
 */
export interface LaunchRestartResponseWire {
	/** Restart ID; nullable. */
	readonly id: string | undefined;
	/** Servers the restart will close. */
	readonly instancesImpacted: number;
	/** Players the restart will move. */
	readonly playersImpacted: number;
}

/**
 * Wire shape of `PlaceFilter`.
 */
export interface PlaceFilterWire {
	/** Whether every version but the latest is selected; nullable. */
	readonly excludeCurrentVersion: boolean | undefined;
	/** Selected place versions; nullable. */
	readonly versions: ReadonlyArray<number> | undefined;
}

/**
 * Wire shape of `PlaceRestartStatus`.
 */
export interface PlaceRestartStatusWire {
	/** When the place restart ended; nullable. */
	readonly endTime: string | undefined;
	/** The applied version filter; nullable. */
	readonly filter: PlaceFilterWire | undefined;
	/** Latest version at launch; nullable. */
	readonly latestVersion: string | undefined;
	/** Servers still to close. */
	readonly remainingInstances: number;
	/** Players still to move. */
	readonly remainingPlayers: number;
	/** When the place restart started. */
	readonly startTime: string;
	/** `RestartState` enum member. */
	readonly state: "DELAYING" | "RESTARTING" | "SUCCEEDED";
	/** Servers selected at launch. */
	readonly totalInstances: number;
	/** Players selected at launch. */
	readonly totalPlayers: number;
}

/**
 * Wire shape of `RestartStatus`.
 */
export interface RestartStatusWire {
	/** Place statuses keyed by place ID; nullable. */
	readonly placeRestartStatuses: Readonly<Record<string, PlaceRestartStatusWire>> | undefined;
	/** When the restart was launched. */
	readonly scheduledTime: string;
	/** When the bleed-off period ends. */
	readonly startTime: string;
	/** Universe the restart belongs to; nullable. Not surfaced publicly. */
	readonly universeId: string | undefined;
}

/**
 * Wire shape of `ListRestartStatusesResponse`.
 */
export interface ListRestartStatusesResponseWire {
	/** Restart statuses keyed by restart ID; nullable. */
	readonly restartStatuses: Readonly<Record<string, RestartStatusWire>> | undefined;
}
