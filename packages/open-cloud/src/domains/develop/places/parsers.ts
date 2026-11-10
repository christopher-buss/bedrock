import type { HttpResponse } from "../../../client/types.ts";
import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Page, Result } from "../../../types.ts";
import type { PlaceSummary } from "./types.ts";

interface PlaceWire {
	readonly id: number;
	readonly name: string;
	readonly description: string;
	readonly universeId: number;
}

/**
 * Parses one page of a universe's places. Numeric IDs become strings and a
 * `null` next cursor becomes `undefined`.
 *
 * @param response - The HTTP response to parse.
 * @returns The parsed page or an `UnexpectedResponseError` when the body is
 *   malformed.
 */
export function parsePlacesListResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<Page<PlaceSummary>, UnexpectedResponseError> {
	if (!isRecord(body) || !Array.isArray(body["data"])) {
		return malformed(statusCode, body);
	}

	const nextPageToken = body["nextPageCursor"] ?? undefined;
	if (nextPageToken !== undefined && typeof nextPageToken !== "string") {
		return malformed(statusCode, body);
	}

	const items: Array<PlaceSummary> = [];
	const places = body["data"];
	for (const item of places) {
		if (!isPlaceWire(item)) {
			return malformed(statusCode, body);
		}

		items.push({
			id: String(item.id),
			name: item.name,
			description: item.description,
			universeId: String(item.universeId),
		});
	}

	return { data: { items, nextPageToken }, success: true };
}

function isPlaceWire(value: unknown): value is PlaceWire {
	return (
		isRecord(value) &&
		Number.isSafeInteger(value["id"]) &&
		Number.isSafeInteger(value["universeId"]) &&
		typeof value["name"] === "string" &&
		typeof value["description"] === "string"
	);
}

function malformed(
	statusCode: number,
	body: unknown,
): Result<Page<PlaceSummary>, UnexpectedResponseError> {
	return {
		err: new UnexpectedResponseError("Malformed places list response", {
			details: toJsonDetails(body),
			statusCode,
		}),
		success: false,
	};
}
