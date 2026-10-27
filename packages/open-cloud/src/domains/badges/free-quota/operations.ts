import type { HttpRequest, HttpResponse } from "../../../client/types.ts";
import type { OpenCloudError } from "../../../errors/base.ts";
import { RateLimitError } from "../../../errors/rate-limit.ts";
import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";
import { parseQuotaResetSeconds } from "../../../internal/http/retry-guidance.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Result } from "../../../types.ts";
import type { GetFreeBadgeQuotaParameters } from "./types.ts";

/** Origin of the unauthenticated free badge quota endpoint. */
export const FREE_QUOTA_BASE_URL = "https://badges.roblox.com";

/**
 * Per-second request ceiling for reading the free badge quota. Roblox
 * reports 60 requests per 60 seconds, per caller.
 */
export const FREE_QUOTA_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 1,
	operationKey: "badges.free-quota",
});

/**
 * Builds the `GET` request for the free badge quota of a universe.
 *
 * @param parameters - The universe to read.
 * @returns A pure {@link HttpRequest} describing the read.
 */
export function buildFreeQuotaRequest({ universeId }: GetFreeBadgeQuotaParameters): HttpRequest {
	return { method: "GET", url: `/v1/universes/${universeId}/free-badges-quota` };
}

/**
 * Parses the free badge quota body, a bare non-negative integer.
 *
 * @param response - The full {@link HttpResponse}.
 * @returns The free badges left today, or an `UnexpectedResponseError` when
 *   the body is not a count.
 */
export function parseFreeQuotaResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<number, UnexpectedResponseError> {
	if (!isCount(body)) {
		return {
			err: new UnexpectedResponseError("Malformed free badge quota response", {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	return { data: body, success: true };
}

/**
 * Points a free badge quota 429 at `x-ratelimit-reset`. The endpoint's
 * `retry-after` is shorter than its window, which reopens only at the reset.
 * Any other error, or a 429 without a reset, passes through unchanged.
 *
 * @param error - The transport error of one attempt.
 * @returns The error with its wait set to the reported reset.
 */
export function waitForQuotaReset(error: OpenCloudError): OpenCloudError {
	if (!(error instanceof RateLimitError)) {
		return error;
	}

	const resetSeconds = parseQuotaResetSeconds(error.responseHeaders?.["x-ratelimit-reset"]);
	if (resetSeconds === undefined) {
		return error;
	}

	return new RateLimitError(error.message, {
		cause: error.cause,
		code: error.code,
		details: error.details,
		remaining: error.remaining,
		responseHeaders: error.responseHeaders,
		retryAfterSeconds: resetSeconds,
		source: error.source,
		statusCode: error.statusCode,
	});
}

function isCount(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}
