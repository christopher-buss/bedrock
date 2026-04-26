import type { HttpResponse } from "../../client/types.ts";
import { ApiError } from "../../errors/api-error.ts";
import { isRecord } from "../../internal/utils/is-record.ts";
import type { Result } from "../../types.ts";
import type { ExperienceIcon, UploadedExperienceIcon } from "./types.ts";
import type { GameIconListWire, GameIconUploadWire, LocalizedGameIconWire } from "./wire.ts";

/**
 * Parses a successful icon-upload response into the public
 * {@link UploadedExperienceIcon} shape, returning a {@link Result} so
 * callers can handle malformed payloads without exceptions.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 *   The status code is included on the returned `ApiError` when validation
 *   fails.
 * @returns A success result wrapping the converted upload, or an
 *   `ApiError` when the body does not match the wire schema.
 */
export function parseIconUploadResponse(
	response: HttpResponse,
): Result<UploadedExperienceIcon, ApiError> {
	const { body, status: statusCode } = response;

	if (!isGameIconUploadWire(body)) {
		return {
			err: new ApiError("Malformed icon upload response", { statusCode }),
			success: false,
		};
	}

	return {
		data: { mediaAssetId: String(body.mediaAssetId) },
		success: true,
	};
}

/**
 * Parses a successful icon-delete response. The endpoint returns no
 * business payload on success; this parser only confirms the response
 * arrived and surfaces `undefined` data.
 *
 * @returns A success result with `undefined` data.
 */
export function parseIconDeleteResponse(): Result<undefined, ApiError> {
	return { data: undefined, success: true };
}

/**
 * Parses a successful icon-list response into a public array of
 * {@link ExperienceIcon} entries. Stringifies each int64 `mediaAssetId`
 * at the wire boundary.
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

function isGameIconUploadWire(body: unknown): body is GameIconUploadWire {
	if (!isRecord(body)) {
		return false;
	}

	return typeof body["mediaAssetId"] === "number";
}

function isLocalizedGameIconWire(value: unknown): value is LocalizedGameIconWire {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value["languageCode"] === "string" && typeof value["mediaAssetId"] === "number";
}

function isGameIconListWire(body: unknown): body is GameIconListWire {
	if (!isRecord(body)) {
		return false;
	}

	const { data } = body;
	if (!Array.isArray(data)) {
		return false;
	}

	for (const entry of data) {
		if (!isLocalizedGameIconWire(entry)) {
			return false;
		}
	}

	return true;
}

function toExperienceIcon(wire: LocalizedGameIconWire): ExperienceIcon {
	return {
		languageCode: wire.languageCode,
		mediaAssetId: String(wire.mediaAssetId),
	};
}
