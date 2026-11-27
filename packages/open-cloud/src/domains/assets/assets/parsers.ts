import type { HttpResponse } from "../../../client/types.ts";
import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Result } from "../../../types.ts";
import type { Asset, ModerationState } from "./types.ts";
import type { AssetWire } from "./wire.ts";

/**
 * Parses an `AssetsUploadApi.Asset` body into the public {@link Asset}.
 *
 * @param response - The full response from the Assets API.
 * @returns The asset, or an `UnexpectedResponseError` when the body has no
 *   asset ID or moderation state.
 */
export function parseAssetResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<Asset, UnexpectedResponseError> {
	if (!isAssetWire(body)) {
		return {
			err: new UnexpectedResponseError("Malformed asset response", {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	return { data: toAsset(body), success: true };
}

function toAsset(wire: AssetWire): Asset {
	return { assetId: wire.assetId, moderationState: wire.moderationResult.moderationState };
}

function isModerationState(value: unknown): value is ModerationState {
	return (
		value === "Approved" ||
		value === "Rejected" ||
		value === "Reviewing" ||
		value === "Unspecified"
	);
}

function isAssetWire(body: unknown): body is AssetWire {
	if (!isRecord(body) || typeof body["assetId"] !== "string") {
		return false;
	}

	const { moderationResult } = body;
	return isRecord(moderationResult) && isModerationState(moderationResult["moderationState"]);
}
