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
