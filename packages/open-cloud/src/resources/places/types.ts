/**
 * Caller-supplied input for the `publish` and `save` methods on
 * `PlacesClient`. Both methods take the same parameter shape; which
 * version-type query string is used is decided by the method, not the
 * caller.
 */
export interface PublishParameters {
	/** Raw `.rbxl` or `.rbxlx` file bytes. Must be non-empty. */
	readonly body: Uint8Array<ArrayBuffer>;
	/**
	 * Whether `body` is the binary or XML place format. The transport
	 * sends `application/octet-stream` for `"rbxl"` and `application/xml`
	 * for `"rbxlx"`, and the builder rejects payloads whose magic bytes
	 * disagree with the declared format before any HTTP call.
	 */
	readonly format: "rbxl" | "rbxlx";
	/** Stringified ID of the place inside the universe. */
	readonly placeId: string;
	/** Stringified ID of the universe that owns the place. */
	readonly universeId: string;
}

/**
 * Successful response from publishing or saving a new place version.
 */
export interface PlaceVersion {
	/**
	 * Auto-incrementing version number assigned by Roblox. Always at least
	 * `1` for the first publish; increases by one for every subsequent
	 * publish or save against the same place.
	 */
	readonly versionNumber: number;
}

/**
 * Parsed representation of a Roblox place's configuration, as returned
 * by the Open Cloud `Cloud_GetPlace` and `Cloud_UpdatePlace` endpoints.
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
