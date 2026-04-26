// Mirrors the Roblox `gameinternationalization` thumbnail endpoints, proxied
// via Open Cloud at `apis.roblox.com/legacy-game-internationalization/v1/...`.
// Internal to the subpath: not re-exported from `index.ts`.
//
// Roblox legacy endpoints predate the Open Cloud OpenAPI vendoring that lives
// in `vendor/roblox-openapi.json`, so these shapes are reconstructed from
// observed responses rather than a vendored schema. `mediaAssetId` is an int64
// on the wire and is stringified at the parser boundary to match the package
// convention for ID fields.

/**
 * Wire shape of `POST /v1/game-thumbnails/games/{gameId}/language-codes/{languageCode}/image`.
 */
export interface GameThumbnailUploadWire {
	/** Int64 media asset ID of the freshly uploaded thumbnail. */
	readonly mediaAssetId: number;
}
