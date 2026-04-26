// Wire shapes for the `gameinternationalization` icon endpoints. `mediaAssetId`
// is int64 on the wire and is stringified at the parser boundary.

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
