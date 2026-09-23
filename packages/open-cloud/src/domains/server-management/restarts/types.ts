/**
 * Caller-supplied input for the `restarts.forecast` method on
 * `UniversesClient`.
 *
 * @since 0.3.3
 */
export interface ForecastRestartParameters {
	/** Stringified ID of the universe to forecast. */
	readonly universeId: string;
}

/**
 * The live servers of one place, and how many of them a restart would
 * close.
 *
 * @since 0.3.3
 */
export interface PlaceRestartForecast {
	/**
	 * Servers a restart would close. Live captures suggest this counts only
	 * servers on an older place version; Roblox does not document it.
	 */
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
	/** Players on the servers counted by `instancesImpacted`. */
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
 * every version. `versions` and `excludeCurrentVersion` are exclusive:
 * the type enforces what Roblox documents, although the server accepts
 * both together.
 *
 * Roblox answers 500 to `excludeCurrentVersion` on a place with no live
 * server, so forecast first when the place may be empty.
 *
 * @since 0.3.3
 *
 * @example
 * ```ts
 * import type { RestartPlaceFilter } from "@bedrock-rbx/ocale/universes";
 *
 * const places: Record<string, RestartPlaceFilter> = {
 *   111: {},
 *   222: { versions: [4, 5] },
 *   333: { excludeCurrentVersion: true },
 * };
 * expect(Object.keys(places)).toEqual(["111", "222", "333"]);
 * ```
 */
export type RestartPlaceFilter =
	| { readonly excludeCurrentVersion: boolean; readonly versions?: never }
	| { readonly excludeCurrentVersion?: never; readonly versions: ReadonlyArray<number> }
	| { readonly excludeCurrentVersion?: never; readonly versions?: never };

/**
 * Caller-supplied input for the `restarts.launch` method on
 * `UniversesClient`.
 *
 * @since 0.3.3
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
 * @since 0.3.3
 */
export interface LaunchedRestart {
	/**
	 * Restart ID, as reported by `restarts.list`. `undefined` when no live
	 * server matched: Roblox then records no restart.
	 */
	readonly id: string | undefined;
	/** Servers the restart will close. */
	readonly instancesImpacted: number;
	/** Players the restart will move to new servers. */
	readonly playersImpacted: number;
}

/**
 * Caller-supplied input for the `restarts.list` method on
 * `UniversesClient`.
 *
 * @since 0.3.3
 */
export interface ListRestartsParameters {
	/** Stringified ID of the universe whose restarts to list. */
	readonly universeId: string;
}

/**
 * Progress of a restart in one place: `DELAYING` during the bleed-off
 * period, `RESTARTING` while servers close, then `SUCCEEDED`.
 *
 * @since 0.3.3
 */
export type RestartState = "DELAYING" | "RESTARTING" | "SUCCEEDED";

/**
 * Progress of a restart in one place.
 *
 * @since 0.3.3
 */
export interface PlaceRestartStatus {
	/** When the place restart ended; `undefined` while it runs. */
	readonly endedAt: Date | undefined;
	/**
	 * The versions the restart selected. Roblox records a launch without
	 * a filter as the versions it found, not as an empty filter.
	 */
	readonly filter: RestartPlaceFilter | undefined;
	/** Latest place version when the restart launched. */
	readonly latestVersion: string | undefined;
	/** Stringified ID of the place. */
	readonly placeId: string;
	/** Servers still to close. */
	readonly remainingInstances: number;
	/** Players still to move. */
	readonly remainingPlayers: number;
	/** When the place restart started. */
	readonly startedAt: Date;
	/** Current state of the place restart. */
	readonly state: RestartState;
	/** Servers selected when the restart launched. */
	readonly totalInstances: number;
	/** Players on the selected servers when the restart launched. */
	readonly totalPlayers: number;
}

/**
 * A restart of a universe's servers and its progress per place.
 *
 * @since 0.3.3
 */
export interface RestartStatus {
	/** Restart ID, as returned by `restarts.launch`. */
	readonly id: string;
	/** Progress per place. */
	readonly places: ReadonlyArray<PlaceRestartStatus>;
	/** When the restart was launched. */
	readonly scheduledAt: Date;
	/** When the bleed-off period ends and servers start to close. */
	readonly startsAt: Date;
}
