import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import type { OpenCloudError } from "../../../errors/base.ts";
import { PermissionError } from "../../../errors/permission-error.ts";
import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Result } from "../../../types.ts";
import { DOWNLOAD_OPERATION_LIMIT, DOWNLOAD_REQUIRED_SCOPES } from "./operations.ts";

/** Body `code` Roblox sends when the credential cannot read the asset. */
const NOT_AUTHORIZED_CODE = 409;

interface AssetDeliveryErrorWire {
	readonly code: number;
	readonly customErrorCode?: unknown;
	readonly message: string;
}

/**
 * Parses an asset delivery response into the signed CDN URL of the stored
 * content. Roblox reports an unreadable or missing asset with HTTP 200 and an
 * `errors` array; the first entry becomes a {@link PermissionError} (body code
 * 409) or an {@link ApiError} whose `statusCode` is the body code.
 *
 * @param response - The HTTP response to parse.
 * @returns The `location` URL, or the error the body describes.
 */
export function parseAssetLocationResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<string, OpenCloudError> {
	if (isRecord(body) && typeof body["location"] === "string") {
		return { data: body["location"], success: true };
	}

	const wire = isRecord(body) && Array.isArray(body["errors"]) ? body["errors"][0] : undefined;
	if (!isAssetDeliveryError(wire)) {
		return {
			err: new UnexpectedResponseError("Malformed asset delivery response", {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	const options = {
		code: typeof wire.customErrorCode === "number" ? String(wire.customErrorCode) : undefined,
		details: toJsonDetails(body),
		statusCode: wire.code,
	};
	const err =
		wire.code === NOT_AUTHORIZED_CODE
			? new PermissionError(wire.message, {
					...options,
					operationKey: DOWNLOAD_OPERATION_LIMIT.operationKey,
					requiredScopes: DOWNLOAD_REQUIRED_SCOPES,
				})
			: new ApiError(wire.message, options);
	return { err, success: false };
}

function isAssetDeliveryError(value: unknown): value is AssetDeliveryErrorWire {
	return (
		isRecord(value) && typeof value["code"] === "number" && typeof value["message"] === "string"
	);
}
