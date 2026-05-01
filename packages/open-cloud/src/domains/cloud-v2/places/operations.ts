import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const UPDATE_PER_MINUTE = 100;
const SECONDS_PER_MINUTE = 60;

/**
 * Per-second request ceiling for updating a place, from the Open Cloud
 * OpenAPI schema (100 requests per minute per API key owner). Keyed
 * independently from the publish operation so publish and update do
 * not share a queue; upstream quota accounting is not documented as
 * shared and the conservative default is fewer cross-method
 * contention surprises.
 */
export const UPDATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: UPDATE_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "places.update",
});

/**
 * Scopes required to update a place's metadata, sourced from
 * `x-roblox-scopes` on the `Cloud_UpdatePlace` operation in the vendored
 * OpenAPI schema.
 */
export const UPDATE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"universe.place:write",
]);
