// Wire shapes for the `gameinternationalization` thumbnail endpoints.
// `mediaAssetId` is int64 on the wire and is stringified at the parser boundary.

/**
 * Wire shape of `POST /v1/game-thumbnails/games/{gameId}/language-codes/{languageCode}/image`.
 */
export interface GameThumbnailUploadWire {
	/** Int64 media asset ID of the freshly uploaded thumbnail. */
	readonly mediaAssetId: number;
}
