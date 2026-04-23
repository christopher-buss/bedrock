import type { HttpResponse } from "../../client/types.ts";
import { ApiError } from "../../errors/api-error.ts";
import { isRecord } from "../../internal/utils/is-record.ts";
import type { Result } from "../../types.ts";
import type { Place, PlaceVersion } from "./types.ts";
import type { PlaceVersionWire, PlaceWire } from "./wire.ts";

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

/**
 * Parses a successful publish-version response into the public
 * {@link PlaceVersion} shape. The Roblox endpoint sometimes returns the
 * JSON-shaped body under a `text/plain` `Content-Type`, so the body may
 * arrive either pre-decoded as a JSON object or still in its raw string
 * form; both are accepted here.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the parsed {@link PlaceVersion}, or
 *   an {@link ApiError} when the body is malformed or its `versionNumber`
 *   field is missing/wrong-typed.
 */
export function parsePublishResponse(response: HttpResponse): Result<PlaceVersion, ApiError> {
	const { body, status: statusCode } = response;

	const decodeResult = decodeBody(body, statusCode);
	if (!decodeResult.success) {
		return decodeResult;
	}

	if (!isPlaceVersionWire(decodeResult.data)) {
		return {
			err: new ApiError("Malformed publish response", { statusCode }),
			success: false,
		};
	}

	return {
		data: { versionNumber: decodeResult.data.versionNumber },
		success: true,
	};
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
		typeof body["createTime"] === "string" &&
		typeof body["updateTime"] === "string" &&
		typeof body["displayName"] === "string" &&
		typeof body["description"] === "string"
	);
}

function isOptionalBoolean(value: unknown): boolean {
	return value === undefined || value === null || typeof value === "boolean";
}

function hasValidPlaceOptional(body: Record<string, unknown>): boolean {
	const serverSize = body["serverSize"] ?? undefined;
	if (serverSize !== undefined && typeof serverSize !== "number") {
		return false;
	}

	return isOptionalBoolean(body["root"]) && isOptionalBoolean(body["universeRuntimeCreation"]);
}

function isPlaceWire(body: unknown): body is PlaceWire {
	if (!isRecord(body)) {
		return false;
	}

	return hasValidPlaceRequired(body) && hasValidPlaceOptional(body);
}

function decodeBody(body: unknown, statusCode: number): Result<unknown, ApiError> {
	if (typeof body !== "string") {
		return { data: body, success: true };
	}

	try {
		return { data: JSON.parse(body), success: true };
	} catch {
		return {
			err: new ApiError("Malformed publish response", { statusCode }),
			success: false,
		};
	}
}

function isPlaceVersionWire(value: unknown): value is PlaceVersionWire {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value["versionNumber"] === "number";
}
