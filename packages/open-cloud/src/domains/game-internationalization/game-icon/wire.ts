/**
 * Image moderation state returned alongside each localized icon.
 */
export type GameIconState = "Approved" | "Error" | "PendingReview" | "Rejected" | "UnAvailable";

/**
 * A single localized icon entry, mirroring
 * `Roblox.GameInternationalization.Api.GetGameIconResponse` from the
 * vendored Open Cloud spec.
 */
export interface GetGameIconResponseWire {
	/** Stringified ID of the uploaded icon image. */
	readonly imageId: string;
	/** CDN URL the icon can be loaded from. */
	readonly imageUrl: string;
	/**
	 * Roblox wire form the icon is registered against -- the Language
	 * form (e.g. `en`, `fil`, `zh-hans`) or the Locale form (e.g.
	 * `en_us`, `pt_br`, `ar_001`), not BCP-47. Typed as `string` rather
	 * than the locale union because the API can return entries for
	 * locales added after our last vendor refresh.
	 */
	readonly languageCode: string;
	/** Moderation state of the icon. */
	readonly state: GameIconState;
}

/**
 * Wire shape of `GET /v1/game-icon/games/{gameId}`, mirroring
 * `Roblox.Web.WebAPI.Models.ApiArrayResponse_…`.
 */
export interface GameIconListWire {
	/** Localized icons in the order returned by the API. */
	readonly data: ReadonlyArray<GetGameIconResponseWire>;
}
