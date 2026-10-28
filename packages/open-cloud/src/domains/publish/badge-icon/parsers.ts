import type { HttpResponse } from "../../../client/types.ts";
import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Result } from "../../../types.ts";
import type { UploadedBadgeIcon } from "./types.ts";

/**
 * Parses a badge icon upload response, whose `targetId` is the asset ID of
 * the uploaded icon.
 *
 * @param response - The full {@link HttpResponse}.
 * @returns The uploaded icon, or an `UnexpectedResponseError` when the body
 *   names no positive integer asset ID.
 */
export function parseUploadIconResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<UploadedBadgeIcon, UnexpectedResponseError> {
	const targetId = isRecord(body) ? body["targetId"] : undefined;
	if (!isAssetId(targetId)) {
		return {
			err: new UnexpectedResponseError("Malformed badge icon upload response", {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	return { data: { iconImageId: String(targetId) }, success: true };
}

function isAssetId(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}
