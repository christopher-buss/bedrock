import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const CREATE_PER_MINUTE = 120;
const GET_PER_MINUTE = 600;
const GET_OPERATION_PER_MINUTE = 300;
const UPDATE_PER_MINUTE = 120;
const SECONDS_PER_MINUTE = 60;

/**
 * Request ceiling for `Assets_GetAsset`, from
 * `x-roblox-rate-limits.perApiKeyOwner` on that operation (600 requests per
 * minute per API key owner).
 */
export const GET_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: GET_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "assets.get",
});

/** Scopes required by `Assets_GetAsset`, from `x-roblox-scopes`. */
export const GET_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze(["asset:read"]);

/**
 * Request ceiling for `Assets_CreateAsset`, from
 * `x-roblox-rate-limits.perApiKeyOwner` on that operation (120 requests per
 * minute per API key owner).
 */
export const CREATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: CREATE_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "assets.create",
});

/**
 * Request ceiling for `Assets_GetOperation`, from
 * `x-roblox-rate-limits.perApiKeyOwner` on that operation (300 requests per
 * minute per API key owner).
 */
export const GET_OPERATION_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: GET_OPERATION_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "assets.get-operation",
});

/**
 * Request ceiling for `Assets_UpdateAsset`, from
 * `x-roblox-rate-limits.perApiKeyOwner` on that operation (120 requests per
 * minute per API key owner).
 */
export const UPDATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: UPDATE_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "assets.update",
});

/**
 * Scopes required by `Assets_CreateAsset`, `Assets_UpdateAsset` and
 * `Assets_GetOperation`, from `x-roblox-scopes`.
 */
export const WRITE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze(["asset:write"]);
