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
	/** BCP-47 language code the icon is registered against. */
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
