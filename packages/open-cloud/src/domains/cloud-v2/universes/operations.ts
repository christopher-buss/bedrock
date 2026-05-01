import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const PER_MINUTE = 100;
const SECONDS_PER_MINUTE = 60;

/**
 * Per-second request ceiling for reading a universe, from the Open
 * Cloud OpenAPI schema (100 requests per minute per API key owner).
 */
export const GET_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "universes.get",
});

/**
 * Per-second request ceiling for updating a universe, from the Open
 * Cloud OpenAPI schema (100 requests per minute per API key owner).
 * Keyed independently from {@link GET_OPERATION_LIMIT} so reads and
 * updates do not share a queue; upstream quota accounting is not
 * documented as shared and the conservative default is fewer
 * cross-method contention surprises.
 */
export const UPDATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "universes.update",
});

/**
 * Scopes required to update a universe, sourced from `x-roblox-scopes`
 * on the `Cloud_UpdateUniverse` operation in the vendored OpenAPI schema.
 * `Cloud_GetUniverse` declares no scope, so the GET method intentionally
 * does not declare `requiredScopes` and a 401/403 there surfaces as a
 * generic ApiError.
 */
export const UPDATE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze(["universe:write"]);
