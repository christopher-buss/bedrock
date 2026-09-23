/**
 * Caller-supplied input for the `restarts.forecast` method on
 * `UniversesClient`.
 *
 * @since unreleased
 */
export interface ForecastRestartParameters {
	/** Stringified ID of the universe to forecast. */
	readonly universeId: string;
}

/**
 * The live servers of one place, and how many of them a restart of old
 * place versions would close.
 *
 * @since unreleased
 */
export interface PlaceRestartForecast {
	/** Servers on an older place version, which a restart would close. */
	readonly instancesImpacted: number;
	/** Live server count keyed by place version. */
	readonly instancesPerVersion: Readonly<Record<string, number>>;
	/**
	 * `true` when the place has moved to another universe but still has
	 * live servers from before the move.
	 */
	readonly isNotInUniverse: boolean;
	/** Most recent place version running on any live server. */
	readonly latestPlaceVersion: string | undefined;
	/** Stringified ID of the place. */
	readonly placeId: string;
	/** Players on servers a restart would close. */
	readonly playersImpacted: number;
	/** Player count keyed by place version. */
	readonly playersPerVersion: Readonly<Record<string, number>>;
	/** When the latest place version was published. */
	readonly publishedAt: Date;
	/** Live servers of the place. */
	readonly totalInstances: number;
	/** Players in the place. */
	readonly totalPlayers: number;
}

/**
 * Which versions of one place a restart closes. An empty filter closes
 * every version. `versions` and `excludeCurrentVersion` are exclusive.
 *
 * Roblox answers 500 to `excludeCurrentVersion` on a place with no live
 * server, so forecast first when the place may be empty.
 *
 * @since unreleased
 */
export type RestartPlaceFilter =
	| { readonly excludeCurrentVersion: boolean; readonly versions?: never }
	| { readonly excludeCurrentVersion?: never; readonly versions: ReadonlyArray<number> }
	| { readonly excludeCurrentVersion?: never; readonly versions?: never };

/**
 * Caller-supplied input for the `restarts.launch` method on
 * `UniversesClient`.
 *
 * @since unreleased
 */
export interface LaunchRestartParameters {
	/**
	 * JSON object (at most 500 bytes serialized) that Roblox sends to the
	 * game servers when the restart is scheduled.
	 */
	readonly attributes?: Readonly<Record<string, JSONValue>>;
	/**
	 * Minutes (1-240) before servers start to close. Players are not
	 * matched into the selected servers during this period.
	 */
	readonly bleedOffDurationMinutes?: number;
	/**
	 * Version filter keyed by stringified place ID. Omit to restart every
	 * version of every place in the universe.
	 */
	readonly places?: Readonly<Record<string, RestartPlaceFilter>>;
	/** Stringified ID of the universe whose servers to restart. */
	readonly universeId: string;
}

/**
 * A restart Roblox accepted, and how much of the universe it reaches.
 *
 * @since unreleased
 */
export interface LaunchedRestart {
	/** Restart ID, as reported by `restarts.list`. */
	readonly id: string;
	/** Servers the restart will close. */
	readonly instancesImpacted: number;
	/** Players the restart will move to new servers. */
	readonly playersImpacted: number;
}
