import type { HttpResponse } from "../../../client/types.ts";
import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { isDateTimeString } from "../../../internal/utils/is-date-time-string.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Page, Result } from "../../../types.ts";
import type {
	Badge,
	BadgeAwarder,
	BadgeAwardingUniverse,
	BadgeDetails,
	BadgeStatistics,
} from "./types.ts";
import type {
	BadgeAwarderWire,
	BadgeAwardingUniverseWire,
	BadgeResponseV2Wire,
	BadgeResponseWire,
	BadgeStatisticsWire,
} from "./wire.ts";

/**
 * Parses a successful Badges API response into the public `Badge` shape,
 * returning a `Result` so callers can handle malformed payloads without
 * exceptions.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 *   The status code is included on the returned `UnexpectedResponseError` when
 *   validation fails; the headers are available for future parsers that need
 *   them.
 * @returns A success result wrapping the converted `Badge`, or an
 *   `UnexpectedResponseError` when the body does not match the wire schema.
 */
export function parseBadgeResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<Badge, UnexpectedResponseError> {
	if (!isBadgeResponseV2Wire(body)) {
		return {
			err: new UnexpectedResponseError("Malformed badge response", {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	return {
		data: { ...copySharedFields(body), awarder: copyAwarder(body.awarder) },
		success: true,
	};
}

/**
 * Parses the body of the unauthenticated badge read endpoints into the public
 * `BadgeDetails` shape.
 *
 * @param response - The full {@link HttpResponse}.
 * @returns A success result wrapping the converted `BadgeDetails`, or an
 *   `UnexpectedResponseError` when the body does not match the wire schema.
 */
export function parseBadgeDetailsResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<BadgeDetails, UnexpectedResponseError> {
	if (!isBadgeResponseWire(body)) {
		return {
			err: new UnexpectedResponseError("Malformed badge response", {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	return {
		data: {
			...copySharedFields(body),
			awardingUniverse: copyAwardingUniverse(body.awardingUniverse),
		},
		success: true,
	};
}

/**
 * Parses a badge list page, keeping its cursor and converting each item with
 * the same validation as a single badge read. A JSON `null` cursor becomes
 * `undefined`.
 *
 * @param response - The HTTP response to parse.
 * @returns The parsed page or an unexpected response error.
 */
export function parseBadgesListResponse(
	response: HttpResponse,
): Result<Page<BadgeDetails>, UnexpectedResponseError> {
	const { body, status: statusCode } = response;
	if (!isRecord(body) || !Array.isArray(body["data"])) {
		return malformedBadgesList(statusCode, body);
	}

	const nextPageToken = body["nextPageCursor"] ?? undefined;
	if (nextPageToken !== undefined && typeof nextPageToken !== "string") {
		return malformedBadgesList(statusCode, body);
	}

	const items: Array<BadgeDetails> = [];
	const badges = body["data"];
	for (const item of badges) {
		const parsed = parseBadgeDetailsResponse({ ...response, body: item });
		if (!parsed.success) {
			return malformedBadgesList(statusCode, body);
		}

		items.push(parsed.data);
	}

	return { data: { items, nextPageToken }, success: true };
}

function copyStatistics(statistics: BadgeStatisticsWire): BadgeStatistics {
	return {
		awardedCount: statistics.awardedCount,
		pastDayAwardedCount: statistics.pastDayAwardedCount,
		winRatePercentage: statistics.winRatePercentage,
	};
}

function copySharedFields(
	body: BadgeResponseV2Wire | BadgeResponseWire,
): Pick<Badge, Exclude<keyof Badge, "awarder">> {
	return {
		id: String(body.id),
		name: body.name,
		createdAt: new Date(body.created),
		description: body.description,
		displayDescription: body.displayDescription,
		displayIconImageId:
			body.displayIconImageId === 0 ? undefined : String(body.displayIconImageId),
		displayName: body.displayName,
		enabled: body.enabled,
		iconImageId: body.iconImageId === 0 ? undefined : String(body.iconImageId),
		statistics: copyStatistics(body.statistics),
		updatedAt: new Date(body.updated),
	};
}

function copyAwarder(awarder: BadgeAwarderWire): BadgeAwarder {
	return { id: String(awarder.id), name: awarder.name, type: awarder.type };
}

function hasRequiredPrimitiveFields(body: Record<string, unknown>): boolean {
	return (
		typeof body["id"] === "number" &&
		typeof body["name"] === "string" &&
		typeof body["description"] === "string" &&
		typeof body["displayName"] === "string" &&
		typeof body["displayDescription"] === "string" &&
		typeof body["enabled"] === "boolean" &&
		typeof body["iconImageId"] === "number" &&
		typeof body["displayIconImageId"] === "number" &&
		isDateTimeString(body["created"]) &&
		isDateTimeString(body["updated"])
	);
}

function isBadgeAwarderWire(value: unknown): value is BadgeAwarderWire {
	if (!isRecord(value)) {
		return false;
	}

	return (
		typeof value["id"] === "number" &&
		(value["name"] === undefined || typeof value["name"] === "string") &&
		value["type"] === "Place"
	);
}

function isBadgeStatisticsWire(value: unknown): value is BadgeStatisticsWire {
	if (!isRecord(value)) {
		return false;
	}

	return (
		typeof value["awardedCount"] === "number" &&
		typeof value["pastDayAwardedCount"] === "number" &&
		typeof value["winRatePercentage"] === "number"
	);
}

function isBadgeResponseV2Wire(body: unknown): body is BadgeResponseV2Wire {
	if (!isRecord(body)) {
		return false;
	}

	if (!hasRequiredPrimitiveFields(body)) {
		return false;
	}

	if (!isBadgeAwarderWire(body["awarder"])) {
		return false;
	}

	if (!isBadgeStatisticsWire(body["statistics"])) {
		return false;
	}

	return true;
}

function copyAwardingUniverse(universe: BadgeAwardingUniverseWire): BadgeAwardingUniverse {
	return {
		id: String(universe.id),
		name: universe.name,
		rootPlaceId: String(universe.rootPlaceId),
	};
}

function isBadgeAwardingUniverseWire(value: unknown): value is BadgeAwardingUniverseWire {
	if (!isRecord(value)) {
		return false;
	}

	return (
		typeof value["id"] === "number" &&
		typeof value["name"] === "string" &&
		typeof value["rootPlaceId"] === "number"
	);
}

function isBadgeResponseWire(body: unknown): body is BadgeResponseWire {
	return (
		isRecord(body) &&
		hasRequiredPrimitiveFields(body) &&
		isBadgeStatisticsWire(body["statistics"]) &&
		isBadgeAwardingUniverseWire(body["awardingUniverse"])
	);
}

function malformedBadgesList(
	statusCode: number,
	body: unknown,
): Result<Page<BadgeDetails>, UnexpectedResponseError> {
	return {
		err: new UnexpectedResponseError("Malformed badges list response", {
			details: toJsonDetails(body),
			statusCode,
		}),
		success: false,
	};
}
