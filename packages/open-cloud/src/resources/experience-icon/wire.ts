// Mirrors the Roblox `gameinternationalization` icon endpoints, proxied via
// Open Cloud at `apis.roblox.com/legacy-game-internationalization/v1/...`.
// Internal to the subpath: not re-exported from `index.ts`.
//
// Roblox legacy endpoints predate the Open Cloud OpenAPI vendoring that lives
// in `vendor/roblox-openapi.json`, so these shapes are reconstructed from
// observed responses rather than a vendored schema. `mediaAssetId` is an int64
// on the wire and is stringified at the parser boundary to match the package
// convention for ID fields.

/**
 * A single localized icon entry returned by the icon list endpoint.
 */
export interface LocalizedGameIconWire {
	/** BCP-47 language code the icon is registered against (e.g. `en-us`). */
	readonly languageCode: string;
	/** Int64 media asset ID, serialized as a JSON number. */
	readonly mediaAssetId: number;
}

/**
 * Wire shape of `GET /v1/game-icon/games/{gameId}`.
 */
export interface GameIconListWire {
	/** Localized icons in the order returned by the API. */
	readonly data: ReadonlyArray<LocalizedGameIconWire>;
}

/**
 * Wire shape of `POST /v1/game-icon/games/{gameId}/language-codes/{languageCode}`.
 */
export interface GameIconUploadWire {
	/** Int64 media asset ID of the freshly uploaded icon. */
	readonly mediaAssetId: number;
}
