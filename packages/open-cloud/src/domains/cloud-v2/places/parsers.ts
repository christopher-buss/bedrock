import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isDateTimeString } from "../../../internal/utils/is-date-time-string.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { Place } from "./types.ts";
import type { PlaceWire } from "./wire.ts";

const MALFORMED_PLACE_MESSAGE = "Malformed place response";

interface ToPlaceArgs {
	readonly id: string;
	readonly body: PlaceWire;
	readonly universeId: string;
}

/**
 * Parses a successful Open Cloud `Place` response body into the public
 * {@link Place} shape.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the parsed {@link Place}, or an
 *   {@link ApiError} when the body does not match the wire schema.
 */
export function parsePlaceResponse(response: HttpResponse): Result<Place, ApiError> {
	const { body, status: statusCode } = response;

	if (!isPlaceWire(body)) {
		return malformedPlace(statusCode);
	}

	const match = /^universes\/(\d+)\/places\/(\d+)$/.exec(body.path);
	const universeId = match?.[1];
	const id = match?.[2];
	if (id === undefined || universeId === undefined) {
		return malformedPlace(statusCode);
	}

	return { data: toPlace({ id, body, universeId }), success: true };
}

function malformedPlace(statusCode: number): Result<Place, ApiError> {
	return {
		err: new ApiError(MALFORMED_PLACE_MESSAGE, { statusCode }),
		success: false,
	};
}

function toPlace(args: ToPlaceArgs): Place {
	const { id, body, universeId } = args;
	return {
		id,
		createdAt: new Date(body.createTime),
		description: body.description,
		displayName: body.displayName,
		root: body.root ?? false,
		serverSize: body.serverSize ?? undefined,
		universeId,
		universeRuntimeCreation: body.universeRuntimeCreation ?? false,
		updatedAt: new Date(body.updateTime),
	};
}

function hasValidPlaceRequired(body: Record<string, unknown>): boolean {
	return (
		typeof body["path"] === "string" &&
		isDateTimeString(body["createTime"]) &&
		isDateTimeString(body["updateTime"]) &&
		typeof body["displayName"] === "string" &&
		typeof body["description"] === "string"
	);
}

function isOptionalBoolean(value: unknown): boolean {
	return value === undefined || value === null || typeof value === "boolean";
}

function hasValidPlaceOptional(body: Record<string, unknown>): boolean {
	const serverSize = body["serverSize"] ?? undefined;
	return (
		(serverSize === undefined || typeof serverSize === "number") &&
		isOptionalBoolean(body["root"]) &&
		isOptionalBoolean(body["universeRuntimeCreation"])
	);
}

function isPlaceWire(body: unknown): body is PlaceWire {
	return isRecord(body) && hasValidPlaceRequired(body) && hasValidPlaceOptional(body);
}
