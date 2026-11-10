import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

/** Origin of the unauthenticated develop places endpoint. */
export const LIST_PLACES_BASE_URL = "https://develop.roblox.com";

/**
 * Per-second ceiling for listing places. Not published in the OpenAPI spec;
 * observed 2026-11-09 on 200 and 400 responses as
 * `x-ratelimit-limit: 10000, 10000;w=60` (10000 requests per 60 seconds).
 */
export const LIST_PLACES_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 10_000 / 60,
	operationKey: "places.list",
});
