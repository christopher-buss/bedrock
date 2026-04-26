import type { HttpResponse } from "../../client/types.ts";
import { ApiError } from "../../errors/api-error.ts";
import { isRecord } from "../../internal/utils/is-record.ts";
import type { Result } from "../../types.ts";
import type { ExperienceIcon } from "./types.ts";
import type { GameIconListWire, GameIconState, GetGameIconResponseWire } from "./wire.ts";

/**
 * Parses a successful icon-list response into a public array of
 * {@link ExperienceIcon} entries.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the converted icon list, or an
 *   `ApiError` when the body does not match the wire schema.
 */
export function parseIconListResponse(
	response: HttpResponse,
): Result<ReadonlyArray<ExperienceIcon>, ApiError> {
	const { body, status: statusCode } = response;

	if (!isGameIconListWire(body)) {
		return {
			err: new ApiError("Malformed icon list response", { statusCode }),
			success: false,
		};
	}

	return {
		data: body.data.map(toExperienceIcon),
		success: true,
	};
}

function isGameIconState(value: unknown): value is GameIconState {
	return (
		value === "Approved" ||
		value === "Error" ||
		value === "PendingReview" ||
		value === "Rejected" ||
		value === "UnAvailable"
	);
}

function isGetGameIconResponseWire(value: unknown): value is GetGameIconResponseWire {
	if (!isRecord(value)) {
		return false;
	}

	return (
		typeof value["imageId"] === "string" &&
		typeof value["imageUrl"] === "string" &&
		typeof value["languageCode"] === "string" &&
		isGameIconState(value["state"])
	);
}

function isGameIconListWire(body: unknown): body is GameIconListWire {
	if (!isRecord(body)) {
		return false;
	}

	const { data } = body;
	if (!Array.isArray(data)) {
		return false;
	}

	return data.every(isGetGameIconResponseWire);
}

function toExperienceIcon(wire: GetGameIconResponseWire): ExperienceIcon {
	return {
		imageId: wire.imageId,
		imageUrl: wire.imageUrl,
		languageCode: wire.languageCode,
		state: wire.state,
	};
}
