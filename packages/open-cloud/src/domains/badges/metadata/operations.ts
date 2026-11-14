import type { HttpRequest, HttpResponse } from "../../../client/types.ts";
import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Result } from "../../../types.ts";

/** Origin of the unauthenticated badge metadata endpoint. */
export const METADATA_BASE_URL = "https://badges.roblox.com";

/**
 * Per-second request ceiling for reading the badge metadata. The vendored
 * spec declares no limit; Roblox reports 100 requests per 60 seconds, per
 * caller.
 */
export const METADATA_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 100 / 60,
	operationKey: "badges.metadata",
});

/**
 * Builds the `GET` request for the badge metadata.
 *
 * @returns A pure {@link HttpRequest} describing the read.
 */
export function buildMetadataRequest(): HttpRequest {
	return { method: "GET", url: "/v1/badges/metadata" };
}

/**
 * Parses the badge metadata body down to its `badgeCreationPrice`.
 *
 * @param response - The full {@link HttpResponse}.
 * @returns The badge creation price in Robux, or an
 *   `UnexpectedResponseError` when the body carries no valid price.
 */
export function parseCreationPriceResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<number, UnexpectedResponseError> {
	const price = isRecord(body) ? body["badgeCreationPrice"] : undefined;
	if (!isPrice(price)) {
		return {
			err: new UnexpectedResponseError("Malformed badge metadata response", {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	return { data: price, success: true };
}

function isPrice(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}
