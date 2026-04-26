import type { HttpResponse } from "../../client/types.ts";
import { ApiError } from "../../errors/api-error.ts";
import { isRecord } from "../../internal/utils/is-record.ts";
import type { Result } from "../../types.ts";
import type { UploadedExperienceThumbnail } from "./types.ts";
import type { GameThumbnailUploadWire } from "./wire.ts";

/**
 * Parses a successful thumbnail-upload response into the public
 * {@link UploadedExperienceThumbnail} shape, returning a {@link Result}
 * so callers can handle malformed payloads without exceptions.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the converted upload, or an
 *   `ApiError` when the body does not match the wire schema.
 */
export function parseThumbnailUploadResponse(
	response: HttpResponse,
): Result<UploadedExperienceThumbnail, ApiError> {
	const { body, status: statusCode } = response;

	if (!isGameThumbnailUploadWire(body)) {
		return {
			err: new ApiError("Malformed thumbnail upload response", { statusCode }),
			success: false,
		};
	}

	return {
		data: { mediaAssetId: String(body.mediaAssetId) },
		success: true,
	};
}

/**
 * Parses a successful thumbnail-delete response. The endpoint returns no
 * business payload on success; this parser only surfaces `undefined` data.
 *
 * @returns A success result with `undefined` data.
 */
export function parseThumbnailDeleteResponse(): Result<undefined, ApiError> {
	return { data: undefined, success: true };
}

/**
 * Parses a successful thumbnail-reorder response. The endpoint returns no
 * business payload on success; this parser only surfaces `undefined` data.
 *
 * @returns A success result with `undefined` data.
 */
export function parseThumbnailReorderResponse(): Result<undefined, ApiError> {
	return { data: undefined, success: true };
}

function isGameThumbnailUploadWire(body: unknown): body is GameThumbnailUploadWire {
	if (!isRecord(body)) {
		return false;
	}

	return typeof body["mediaAssetId"] === "number";
}
