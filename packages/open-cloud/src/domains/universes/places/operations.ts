import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

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
 * Scopes required to publish or save a place version, sourced from
 * `x-roblox-scopes` on the `Places_CreatePlaceVersionApiKey` operation
 * in the vendored OpenAPI schema.
 */
export const PUBLISH_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"universe-places:write",
]);
