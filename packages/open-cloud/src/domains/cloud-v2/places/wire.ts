// Wire-level shapes for responses returned by the Open Cloud
// `cloud/v2` place endpoints. Internal to the sub-tree; not re-exported.

/**
 * Wire shape of the `Place` resource -- the response body returned by
 * `Cloud_GetPlace` and `Cloud_UpdatePlace`. Genuinely optional fields
 * are `T | undefined` so callers can simulate absence under
 * `exactOptionalPropertyTypes`. The parser normalizes JSON `null`
 * values to `undefined` at validation time so consumers only ever
 * observe `undefined`.
 */
export interface PlaceWire {
	/** ISO timestamp when the place was created (`date-time`). */
	readonly createTime: string;
	/** Long-form description of the place. */
	readonly description: string;
	/** Human-facing name of the place. */
	readonly displayName: string;
	/** Resource path, e.g. `"universes/{uid}/places/{pid}"`. */
	readonly path: string;
	/** Whether this place is the universe's root place. */
	readonly root?: boolean | undefined;
	/** Maximum number of allowed users in a single server. */
	readonly serverSize?: number | undefined;
	/** Whether the place was created in-experience via `AssetService::CreatePlaceAsync()`. */
	readonly universeRuntimeCreation?: boolean | undefined;
	/** ISO timestamp of the most recent update (`date-time`). */
	readonly updateTime: string;
}
