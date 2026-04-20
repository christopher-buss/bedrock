import type { HttpResponse } from "../../client/types.ts";
import { ApiError } from "../../errors/api-error.ts";
import type { Result } from "../../types.ts";
import type { GamePass, GamePassPrice } from "./types.ts";
import type { GamePassConfigV2, PriceInformationStructWire, PricingFeatureWire } from "./wire.ts";

/**
 * Parses a successful Game Pass API response into the public `GamePass`
 * shape, returning a `Result` so callers can handle malformed payloads
 * without exceptions.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 *   The status code is included on the returned `ApiError` when validation
 *   fails; the headers are available for future parsers that need them.
 * @returns A success result wrapping the converted `GamePass`, or an
 *   `ApiError` when the body does not match the wire schema.
 */
export function parseGamePassResponse(response: HttpResponse): Result<GamePass, ApiError> {
	const { body, status: statusCode } = response;

	if (!isGamePassConfigV2(body)) {
		return {
			err: new ApiError("Malformed game pass response", { statusCode }),
			success: false,
		};
	}

	const priceWire = body.priceInformation ?? undefined;

	return {
		data: {
			id: String(body.gamePassId),
			name: body.name,
			createdAt: new Date(body.createdTimestamp),
			description: body.description,
			iconAssetId: body.iconAssetId === 0 ? undefined : String(body.iconAssetId),
			isForSale: body.isForSale,
			price: priceWire === undefined ? undefined : toGamePassPrice(priceWire),
			updatedAt: new Date(body.updatedTimestamp),
		},
		success: true,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}

function hasRequiredPrimitiveFields(body: Record<string, unknown>): boolean {
	return (
		typeof body["gamePassId"] === "number" &&
		typeof body["name"] === "string" &&
		typeof body["description"] === "string" &&
		typeof body["isForSale"] === "boolean" &&
		typeof body["iconAssetId"] === "number" &&
		typeof body["createdTimestamp"] === "string" &&
		typeof body["updatedTimestamp"] === "string"
	);
}

function isPricingFeatureWire(value: unknown): value is PricingFeatureWire {
	return (
		value === "Invalid" ||
		value === "PriceOptimization" ||
		value === "RegionalPricing" ||
		value === "UserFixedPrice"
	);
}

function isPriceInformationStructWire(value: unknown): value is PriceInformationStructWire {
	if (!isRecord(value)) {
		return false;
	}

	const defaultPrice = value["defaultPriceInRobux"] ?? undefined;
	if (defaultPrice !== undefined && typeof defaultPrice !== "number") {
		return false;
	}

	const features = value["enabledFeatures"];
	if (!Array.isArray(features)) {
		return false;
	}

	for (const feature of features) {
		if (!isPricingFeatureWire(feature)) {
			return false;
		}
	}

	return true;
}

function isGamePassConfigV2(body: unknown): body is GamePassConfigV2 {
	if (!isRecord(body)) {
		return false;
	}

	if (!hasRequiredPrimitiveFields(body)) {
		return false;
	}

	const price = body["priceInformation"] ?? undefined;
	if (price !== undefined && !isPriceInformationStructWire(price)) {
		return false;
	}

	return true;
}

function toGamePassPrice(wire: PriceInformationStructWire): GamePassPrice {
	return {
		defaultPriceInRobux: wire.defaultPriceInRobux ?? undefined,
		enabledFeatures: [...wire.enabledFeatures],
	};
}
