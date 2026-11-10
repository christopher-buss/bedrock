/**
 * Page sizes the develop places endpoint accepts. Any other value is
 * rejected with HTTP 400.
 *
 * @since unreleased
 */
export type ListPlacesPageSize = 10 | 25 | 50 | 100;

/**
 * Parameters for listing the places of a universe. Pass the returned
 * `nextPageToken` as `pageToken` until it is undefined.
 *
 * @since unreleased
 */
export interface ListPlacesParameters {
	/** Optional page size; the server defaults to 10. */
	readonly pageSize?: ListPlacesPageSize;
	/** Cursor returned by the previous page. */
	readonly pageToken?: string;
	/** Stringified universe ID. */
	readonly universeId: string;
}

/**
 * One place in a universe, as listed by `PlacesClient.list`.
 *
 * @since unreleased
 */
export interface PlaceSummary {
	/** Stringified place ID. */
	readonly id: string;
	/** Place name. */
	readonly name: string;
	/** Place description; empty when unset. */
	readonly description: string;
	/** Stringified ID of the universe that owns the place. */
	readonly universeId: string;
}
