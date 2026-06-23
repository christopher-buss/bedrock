/**
 * Caller-supplied input for the `update` method on `PlacesClient`.
 * Every writable field is optional; presence of a key drives the
 * `updateMask` query string that the server uses as the field-mask
 * for the partial update. Absent keys are left untouched server-side.
 *
 * @since 0.1.0
 */
export interface UpdatePlaceParameters {
	/** New description for the place. */
	readonly description?: string;
	/** New display name for the place. */
	readonly displayName?: string;
	/** Stringified ID of the place to update. */
	readonly placeId: string;
	/** New maximum number of allowed users in a single server. */
	readonly serverSize?: number;
	/** Stringified ID of the universe that owns the place. */
	readonly universeId: string;
}

/**
 * Parsed representation of a Roblox place's configuration, as returned
 * by the Open Cloud `Cloud_GetPlace` and `Cloud_UpdatePlace` endpoints.
 *
 * @since 0.1.0
 */
export interface Place {
	/** Stringified place ID, extracted from the wire `path`. */
	readonly id: string;
	/** Timestamp when the place was created. */
	readonly createdAt: Date;
	/** Long-form description of the place. */
	readonly description: string;
	/** Human-facing name of the place. */
	readonly displayName: string;
	/** Whether this place is the universe's root place. */
	readonly root: boolean;
	/** Maximum allowed users in a single server; `undefined` when unset. */
	readonly serverSize: number | undefined;
	/** Stringified universe ID, extracted from the wire `path`. */
	readonly universeId: string;
	/** Whether the place was created in-experience. */
	readonly universeRuntimeCreation: boolean;
	/** Timestamp of the most recent update. */
	readonly updatedAt: Date;
}
