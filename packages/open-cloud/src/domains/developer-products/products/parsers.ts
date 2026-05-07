import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import {
	copyPriceInformation,
	isPriceInformationLike,
} from "../../../internal/price-information.ts";
import { isDateTimeString } from "../../../internal/utils/is-date-time-string.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { DeveloperProduct } from "./types.ts";
import type { DeveloperProductConfigV2, DeveloperProductPricingFeatureWire } from "./wire.ts";

/**
 * Parses a successful Developer Products API response into the public
 * `DeveloperProduct` shape, returning a `Result` so callers can handle
 * malformed payloads without exceptions.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 *   The status code is included on the returned `ApiError` when validation
 *   fails; the headers are available for future parsers that need them.
 * @returns A success result wrapping the converted `DeveloperProduct`, or
 *   an `ApiError` when the body does not match the wire schema.
 */
export function parseDeveloperProductResponse(
	response: HttpResponse,
): Result<DeveloperProduct, ApiError> {
	const { body, status: statusCode } = response;

	if (!isDeveloperProductConfigV2(body)) {
		return {
			err: new ApiError("Malformed developer product response", { statusCode }),
			success: false,
		};
	}

	const priceWire = body.priceInformation ?? undefined;
	const iconAssetId = body.iconImageAssetId ?? undefined;

	return {
		data: {
			id: String(body.productId),
			name: body.name,
			createdAt: new Date(body.createdTimestamp),
			description: body.description,
			iconImageAssetId: iconAssetId === undefined ? undefined : String(iconAssetId),
			isForSale: body.isForSale,
			isImmutable: body.isImmutable,
			price: priceWire === undefined ? undefined : copyPriceInformation(priceWire),
			storePageEnabled: body.storePageEnabled,
			universeId: String(body.universeId),
			updatedAt: new Date(body.updatedTimestamp),
		},
		success: true,
	};
}

function hasRequiredPrimitiveFields(body: Record<string, unknown>): boolean {
	return (
		typeof body["productId"] === "number" &&
		// Roblox never assigns asset ID 0; a zero productId signals a
		// malformed response, not a legitimate product.
		body["productId"] !== 0 &&
		typeof body["universeId"] === "number" &&
		typeof body["name"] === "string" &&
		typeof body["description"] === "string" &&
		typeof body["isForSale"] === "boolean" &&
		typeof body["isImmutable"] === "boolean" &&
		typeof body["storePageEnabled"] === "boolean" &&
		isDateTimeString(body["createdTimestamp"]) &&
		isDateTimeString(body["updatedTimestamp"])
	);
}

function isPricingFeatureWire(value: unknown): value is DeveloperProductPricingFeatureWire {
	return (
		value === "Invalid" ||
		value === "PriceOptimization" ||
		value === "RegionalPricing" ||
		value === "UserFixedPrice"
	);
}

function isDeveloperProductConfigV2(body: unknown): body is DeveloperProductConfigV2 {
	if (!isRecord(body)) {
		return false;
	}

	if (!hasRequiredPrimitiveFields(body)) {
		return false;
	}

	const iconImageAssetId = body["iconImageAssetId"] ?? undefined;
	if (iconImageAssetId !== undefined && typeof iconImageAssetId !== "number") {
		return false;
	}

	const price = body["priceInformation"] ?? undefined;
	if (price !== undefined && !isPriceInformationLike(price, isPricingFeatureWire)) {
		return false;
	}

	return true;
}
