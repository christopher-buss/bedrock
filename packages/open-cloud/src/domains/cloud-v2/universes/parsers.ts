import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type {
	SocialLink,
	Universe,
	UniverseAgeRating,
	UniverseOwner,
	UniverseVisibility,
} from "./types.ts";
import type { AgeRatingWire, SocialLinkWire, UniverseWire, VisibilityWire } from "./wire.ts";

const VISIBILITY_MAP: Readonly<Record<VisibilityWire, UniverseVisibility>> = {
	PRIVATE: "private",
	PUBLIC: "public",
	VISIBILITY_UNSPECIFIED: "unspecified",
};

const AGE_RATING_MAP: Readonly<Record<AgeRatingWire, UniverseAgeRating>> = {
	AGE_RATING_9_PLUS: "9Plus",
	AGE_RATING_13_PLUS: "13Plus",
	AGE_RATING_17_PLUS: "17Plus",
	AGE_RATING_ALL: "all",
	AGE_RATING_UNSPECIFIED: "unspecified",
};

const MALFORMED_MESSAGE = "Malformed universe response";

interface ToUniverseArgs {
	readonly id: string;
	readonly body: UniverseWire;
	readonly owner: UniverseOwner;
}

/**
 * Parses a successful Open Cloud `Universe` response body into the
 * public {@link Universe} shape.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the parsed {@link Universe}, or
 *   an {@link ApiError} when the body does not match the wire schema.
 */
export function parseUniverseResponse(response: HttpResponse): Result<Universe, ApiError> {
	const { body, status: statusCode } = response;

	if (!isUniverseWire(body)) {
		return malformed(statusCode);
	}

	const ownerResult = resolveOwner(body);
	if (!ownerResult.success) {
		return malformed(statusCode);
	}

	const idMatch = /^universes\/(\d+)$/.exec(body.path);
	const id = idMatch?.[1];
	if (id === undefined) {
		return malformed(statusCode);
	}

	return { data: toUniverse({ id, body, owner: ownerResult.data }), success: true };
}

function malformed(statusCode: number): Result<Universe, ApiError> {
	return {
		err: new ApiError(MALFORMED_MESSAGE, { statusCode }),
		success: false,
	};
}

function extractRootPlaceId(rootPlace: string | undefined): string | undefined {
	if (rootPlace === undefined) {
		return undefined;
	}

	const match = /\/places\/(\d+)$/.exec(rootPlace);
	return match?.[1];
}

function toSocialLink(wire: SocialLinkWire | undefined): SocialLink | undefined {
	if (wire === undefined) {
		return undefined;
	}

	return { title: wire.title, uri: wire.uri };
}

function toUniverse(args: ToUniverseArgs): Universe {
	const { id, body, owner } = args;
	return {
		id,
		ageRating: AGE_RATING_MAP[body.ageRating],
		consoleEnabled: body.consoleEnabled ?? false,
		createdAt: new Date(body.createTime),
		description: body.description,
		desktopEnabled: body.desktopEnabled ?? false,
		discordSocialLink: toSocialLink(body.discordSocialLink),
		displayName: body.displayName,
		facebookSocialLink: toSocialLink(body.facebookSocialLink),
		guildedSocialLink: toSocialLink(body.guildedSocialLink),
		mobileEnabled: body.mobileEnabled ?? false,
		owner,
		privateServerPriceRobux: body.privateServerPriceRobux ?? undefined,
		robloxGroupSocialLink: toSocialLink(body.robloxGroupSocialLink),
		rootPlaceId: extractRootPlaceId(body.rootPlace),
		tabletEnabled: body.tabletEnabled ?? false,
		twitchSocialLink: toSocialLink(body.twitchSocialLink),
		twitterSocialLink: toSocialLink(body.twitterSocialLink),
		updatedAt: new Date(body.updateTime),
		visibility: VISIBILITY_MAP[body.visibility],
		voiceChatEnabled: body.voiceChatEnabled ?? false,
		vrEnabled: body.vrEnabled ?? false,
		youtubeSocialLink: toSocialLink(body.youtubeSocialLink),
	};
}

function isVisibilityWire(value: unknown): value is VisibilityWire {
	return value === "PRIVATE" || value === "PUBLIC" || value === "VISIBILITY_UNSPECIFIED";
}

function isAgeRatingWire(value: unknown): value is AgeRatingWire {
	return (
		value === "AGE_RATING_13_PLUS" ||
		value === "AGE_RATING_17_PLUS" ||
		value === "AGE_RATING_9_PLUS" ||
		value === "AGE_RATING_ALL" ||
		value === "AGE_RATING_UNSPECIFIED"
	);
}

function hasValidRequiredFields(body: Record<string, unknown>): boolean {
	return (
		typeof body["path"] === "string" &&
		typeof body["createTime"] === "string" &&
		typeof body["updateTime"] === "string" &&
		typeof body["displayName"] === "string" &&
		typeof body["description"] === "string" &&
		isVisibilityWire(body["visibility"]) &&
		isAgeRatingWire(body["ageRating"])
	);
}

function isSocialLinkWire(value: unknown): value is SocialLinkWire {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value["title"] === "string" && typeof value["uri"] === "string";
}

function isOptionalSocialLink(value: unknown): boolean {
	return value === undefined || value === null || isSocialLinkWire(value);
}

function isOptionalBoolean(value: unknown): boolean {
	return value === undefined || value === null || typeof value === "boolean";
}

function hasValidOptionalFields(body: Record<string, unknown>): boolean {
	const priceField = body["privateServerPriceRobux"] ?? undefined;
	if (priceField !== undefined && typeof priceField !== "number") {
		return false;
	}

	const rootPlace = body["rootPlace"] ?? undefined;
	if (rootPlace !== undefined && typeof rootPlace !== "string") {
		return false;
	}

	return (
		isOptionalBoolean(body["voiceChatEnabled"]) &&
		isOptionalBoolean(body["desktopEnabled"]) &&
		isOptionalBoolean(body["mobileEnabled"]) &&
		isOptionalBoolean(body["tabletEnabled"]) &&
		isOptionalBoolean(body["consoleEnabled"]) &&
		isOptionalBoolean(body["vrEnabled"]) &&
		isOptionalSocialLink(body["facebookSocialLink"]) &&
		isOptionalSocialLink(body["twitterSocialLink"]) &&
		isOptionalSocialLink(body["youtubeSocialLink"]) &&
		isOptionalSocialLink(body["twitchSocialLink"]) &&
		isOptionalSocialLink(body["discordSocialLink"]) &&
		isOptionalSocialLink(body["robloxGroupSocialLink"]) &&
		isOptionalSocialLink(body["guildedSocialLink"])
	);
}

function isUniverseWire(body: unknown): body is UniverseWire {
	if (!isRecord(body)) {
		return false;
	}

	return hasValidRequiredFields(body) && hasValidOptionalFields(body);
}

function extractOwnerId(resourcePath: string): string | undefined {
	const match = /^(?:users|groups)\/(\d+)$/.exec(resourcePath);
	return match?.[1];
}

function resolveOwner(body: UniverseWire): Result<UniverseOwner, undefined> {
	if (typeof body.user === "string") {
		const id = extractOwnerId(body.user);
		if (id !== undefined) {
			return { data: { id, kind: "user" }, success: true };
		}
	}

	if (typeof body.group === "string") {
		const id = extractOwnerId(body.group);
		if (id !== undefined) {
			return { data: { id, kind: "group" }, success: true };
		}
	}

	return { err: undefined, success: false };
}
