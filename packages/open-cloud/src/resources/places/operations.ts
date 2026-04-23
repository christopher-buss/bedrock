import type { OperationLimit } from "../../internal/http/rate-limit-queue.ts";

const UPDATE_PER_MINUTE = 100;
const SECONDS_PER_MINUTE = 60;

/**
 * Per-second request ceiling for publishing or saving a place version,
 * from the Open Cloud OpenAPI schema (30 requests per minute, expressed
 * here as `0.5` per second). The publish and save methods both reference
 * this constant so that a single per-API-key queue serves both, matching
 * Roblox's server-side accounting which counts both call types against
 * the same per-minute quota.
 */
export const PUBLISH_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 0.5,
	operationKey: "places.publishVersion",
});

/**
 * Per-second request ceiling for updating a place, from the Open Cloud
 * OpenAPI schema (100 requests per minute per API key owner). Keyed
 * independently from {@link PUBLISH_OPERATION_LIMIT} so publish and
 * update do not share a queue; upstream quota accounting is not
 * documented as shared and the conservative default is fewer
 * cross-method contention surprises.
 */
export const UPDATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: UPDATE_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "places.update",
});
