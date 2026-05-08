import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const SUBMIT_PER_MINUTE = 40;
const GET_PER_MINUTE = 200;
const SECONDS_PER_MINUTE = 60;

/**
 * Per-second request ceiling for submitting a Luau execution task,
 * sourced from `x-roblox-rate-limits.perApiKeyOwner` on the
 * `Cloud_CreateLuauExecutionSessionTask__Using_Universes` operation
 * (40 requests per minute per API key owner). The two URL shapes
 * (head and version) share this queue because Roblox attributes both
 * to the same per-minute quota.
 */
export const SUBMIT_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: SUBMIT_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "luau-execution-tasks.submit",
});

/**
 * Per-second request ceiling for fetching a Luau execution task,
 * sourced from `x-roblox-rate-limits.perApiKeyOwner` on the
 * `Cloud_GetLuauExecutionSessionTask` operation (200 requests per
 * minute per API key owner).
 */
export const GET_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: GET_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "luau-execution-tasks.get",
});

/**
 * Scopes required to submit a Luau execution task, sourced from
 * `x-roblox-scopes` on the create operation in the vendored OpenAPI
 * schema. Surfaced via the `requiredScopes` field of the per-method
 * spec so a 401 or 403 ApiError is upgraded to a `PermissionError`
 * naming the missing scope.
 */
export const SUBMIT_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"universe.place.luau-execution-session:write",
]);

/**
 * Scopes required to fetch a Luau execution task, sourced from
 * `x-roblox-scopes` on the get operation. The `:write` scope also
 * grants read in upstream auth, but we surface only `:read` here as
 * the minimum-privilege requirement for this method.
 */
export const GET_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"universe.place.luau-execution-session:read",
]);
