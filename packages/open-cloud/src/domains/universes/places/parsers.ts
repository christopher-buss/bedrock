import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { PlaceVersion } from "./types.ts";
import type { PlaceVersionWire } from "./wire.ts";

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
