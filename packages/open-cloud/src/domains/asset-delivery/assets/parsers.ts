import type { HttpResponse } from "../../../client/types.ts";
import type { OpenCloudError } from "../../../errors/base.ts";
import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Result } from "../../../types.ts";

/**
 * Parses an asset delivery response into the signed CDN URL of the stored
 * content.
 *
 * @param response - The HTTP response to parse.
 * @returns The `location` URL, or the error the body describes.
 */
export function parseAssetLocationResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<string, OpenCloudError> {
	if (!isRecord(body) || typeof body["location"] !== "string") {
		return {
			err: new UnexpectedResponseError("Malformed asset delivery response", {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	return { data: body["location"], success: true };
}
