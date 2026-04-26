/**
 * Wire shape of `POST /v1/game-thumbnails/games/{gameId}/language-codes/{languageCode}/image`,
 * mirroring `Roblox.GameInternationalization.Api.Models.Response.UploadImageForGameThumbnailResponse`.
 */
export interface GameThumbnailUploadWire {
	/** Stringified ID of the freshly uploaded thumbnail. */
	readonly mediaAssetId: string;
}
