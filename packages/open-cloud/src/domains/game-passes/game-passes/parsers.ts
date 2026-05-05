import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import {
	copyPriceInformation,
	isPriceInformationLike,
} from "../../../internal/price-information.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Page, Result } from "../../../types.ts";
import type { GamePass } from "./types.ts";
import type {
	GamePassConfigV2,
	ListGamePassConfigsByUniverseResponseWire,
	PricingFeatureWire,
} from "./wire.ts";

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

	return { data: toGamePass(body), success: true };
}

/**
 * Parses a successful "list game passes" response into a public
 * {@link Page} of {@link GamePass}, returning a `Result` so callers can
 * handle malformed payloads without exceptions. JSON `null` or a missing
 * `nextPageToken` is normalized to `undefined`.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the converted page, or an
 *   `ApiError` when the body does not match the wire schema.
 */
export function parseGamePassesListResponse(
	response: HttpResponse,
): Result<Page<GamePass>, ApiError> {
	const { body, status: statusCode } = response;

	if (!isListResponseWire(body)) {
		return {
			err: new ApiError("Malformed game passes list response", { statusCode }),
			success: false,
		};
	}

	return {
		data: {
			items: body.gamePasses.map(toGamePass),
			nextPageToken: body.nextPageToken ?? undefined,
		},
		success: true,
	};
}

function toGamePass(wire: GamePassConfigV2): GamePass {
	const priceWire = wire.priceInformation ?? undefined;
	return {
		id: String(wire.gamePassId),
		name: wire.name,
		createdAt: new Date(wire.createdTimestamp),
		description: wire.description,
		iconAssetId: wire.iconAssetId === 0 ? undefined : String(wire.iconAssetId),
		isForSale: wire.isForSale,
		price: priceWire === undefined ? undefined : copyPriceInformation(priceWire),
		updatedAt: new Date(wire.updatedTimestamp),
	};
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

function isGamePassConfigV2(body: unknown): body is GamePassConfigV2 {
	if (!isRecord(body)) {
		return false;
	}

	if (!hasRequiredPrimitiveFields(body)) {
		return false;
	}

	const price = body["priceInformation"] ?? undefined;
	if (price !== undefined && !isPriceInformationLike(price, isPricingFeatureWire)) {
		return false;
	}

	return true;
}

function isListResponseWire(body: unknown): body is ListGamePassConfigsByUniverseResponseWire {
	if (!isRecord(body)) {
		return false;
	}

	const { gamePasses } = body;
	if (!Array.isArray(gamePasses)) {
		return false;
	}

	for (const item of gamePasses) {
		if (!isGamePassConfigV2(item)) {
			return false;
		}
	}

	const nextPageToken = body["nextPageToken"] ?? undefined;
	if (nextPageToken !== undefined && typeof nextPageToken !== "string") {
		return false;
	}

	return true;
}
