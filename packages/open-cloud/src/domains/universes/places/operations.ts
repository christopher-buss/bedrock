import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const PUBLISH_PER_MINUTE = 30;
const SECONDS_PER_MINUTE = 60;

/**
 * Per-second request ceiling for publishing or saving a place version,
 * from the Open Cloud OpenAPI schema (30 requests per minute, which works
 * out to `0.5` per second and is also the burst the server allows). The
 * publish and save methods both reference this constant so that a single
 * per-API-key queue serves both, matching Roblox's server-side accounting
 * which counts both call types against the same per-minute quota.
 */
export const PUBLISH_OPERATION_LIMIT: OperationLimit = Object.freeze({
	burstCapacity: PUBLISH_PER_MINUTE,
	maxPerSecond: PUBLISH_PER_MINUTE / SECONDS_PER_MINUTE,
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
