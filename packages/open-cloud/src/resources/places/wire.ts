// Wire-level shape for the response body returned by the place
// publish-version endpoint. Internal to the subpath; not re-exported.

/**
 * Wire shape of the publish-version success response body.
 */
export interface PlaceVersionWire {
	/** Auto-incrementing version number assigned by Roblox. */
	readonly versionNumber: number;
}
