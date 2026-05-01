// Wire-level shapes for responses returned by the legacy
// `/universes/v1/.../versions` place-publishing endpoint. Internal to
// the subpath; not re-exported.

/**
 * Wire shape of the publish-version success response body.
 */
export interface PlaceVersionWire {
	/** Auto-incrementing version number assigned by Roblox. */
	readonly versionNumber: number;
}
