import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isDateTimeString } from "../../../internal/utils/is-date-time-string.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { Badge, BadgeAwarder, BadgeStatistics } from "./types.ts";
import type { BadgeAwarderWire, BadgeResponseV2Wire, BadgeStatisticsWire } from "./wire.ts";

/**
 * Parses a successful Badges API response into the public `Badge` shape,
 * returning a `Result` so callers can handle malformed payloads without
 * exceptions.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 *   The status code is included on the returned `ApiError` when validation
 *   fails; the headers are available for future parsers that need them.
 * @returns A success result wrapping the converted `Badge`, or an
 *   `ApiError` when the body does not match the wire schema.
 */
export function parseBadgeResponse(response: HttpResponse): Result<Badge, ApiError> {
	const { body, status: statusCode } = response;

	if (!isBadgeResponseV2Wire(body)) {
		return {
			err: new ApiError("Malformed badge response", { statusCode }),
			success: false,
		};
	}

	return {
		data: {
			id: String(body.id),
			name: body.name,
			awarder: copyAwarder(body.awarder),
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
		},
		success: true,
	};
}

function copyAwarder(awarder: BadgeAwarderWire): BadgeAwarder {
	return { id: String(awarder.id), name: awarder.name, type: "Place" };
}

function copyStatistics(statistics: BadgeStatisticsWire): BadgeStatistics {
	return {
		awardedCount: statistics.awardedCount,
		pastDayAwardedCount: statistics.pastDayAwardedCount,
		winRatePercentage: statistics.winRatePercentage,
	};
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
		typeof value["id"] === "number" && typeof value["name"] === "string" && value["type"] === 1
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
