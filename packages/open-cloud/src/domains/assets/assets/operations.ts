import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const GET_PER_MINUTE = 600;
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
