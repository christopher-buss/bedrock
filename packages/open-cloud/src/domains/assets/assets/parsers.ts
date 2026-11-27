import type { HttpResponse } from "../../../client/types.ts";
import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Result } from "../../../types.ts";
import type { Asset, ModerationState } from "./types.ts";
import type { AssetOperation, AssetOperationStatus, AssetWire } from "./wire.ts";

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

/**
 * Parses a `readMask=icon` body into the image asset ID of the icon. The
 * body holds only `icon`, as `"assets/<id>"`, and is `{}` when the asset has
 * no icon.
 *
 * @param response - The full response from the Assets API.
 * @returns The icon's image asset ID, `undefined` when there is no icon, or
 *   an `UnexpectedResponseError` when `icon` is not an asset path.
 */
export function parseAssetIconResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<string | undefined, UnexpectedResponseError> {
	const icon = isRecord(body) ? readIcon(body["icon"]) : MALFORMED;
	if (icon === MALFORMED) {
		return {
			err: new UnexpectedResponseError("Malformed asset icon response", {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	return { data: icon, success: true };
}

/**
 * Parses an `AssetsUploadApi.Operation` body. The `response` is left
 * unparsed: each caller reads only what it needs from it.
 *
 * @param response - The full response from the Assets API.
 * @returns The operation, or an `UnexpectedResponseError` when the body has
 *   no operation ID or a field of the wrong type.
 */
export function parseAssetOperationResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<AssetOperation, UnexpectedResponseError> {
	const operation = isRecord(body) ? readOperation(body) : MALFORMED;
	if (operation === MALFORMED) {
		return {
			err: new UnexpectedResponseError("Malformed asset operation response", {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	return { data: operation, success: true };
}

const MALFORMED = Symbol("malformed");

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function readStatus(value: unknown): AssetOperationStatus | typeof MALFORMED | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!isRecord(value)) {
		return MALFORMED;
	}

	const { code, message } = value;
	if (!isOptionalString(code) || !isOptionalString(message)) {
		return MALFORMED;
	}

	return { code, message };
}

function readOperation({
	done,
	error,
	operationId,
	response,
}: Record<string, unknown>): AssetOperation | typeof MALFORMED {
	const status = readStatus(error);
	if (
		status === MALFORMED ||
		typeof operationId !== "string" ||
		(done !== undefined && typeof done !== "boolean")
	) {
		return MALFORMED;
	}

	return { done: done === true, error: status, operationId, response };
}

const ASSET_PATH = /^assets\/(\d+)$/;

function readIcon(value: unknown): string | typeof MALFORMED | undefined {
	if (value === undefined) {
		return undefined;
	}

	const match = typeof value === "string" ? ASSET_PATH.exec(value) : undefined;
	return match?.[1] ?? MALFORMED;
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
