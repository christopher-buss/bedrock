import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const LIST_LOGS_PER_MINUTE = 45;
const SECONDS_PER_MINUTE = 60;

/**
 * Per-second request ceiling for listing Luau execution task logs,
 * sourced from `x-roblox-rate-limits.perApiKeyOwner` on the
 * `Cloud_ListLuauExecutionSessionTaskLogs` operation (45 requests per
 * minute per API key owner).
 */
export const LIST_LOGS_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: LIST_LOGS_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "luau-execution-task-logs.list",
});

/**
 * Scopes required to list Luau execution task logs, sourced from
 * `x-roblox-scopes` on the list-logs operation in the vendored OpenAPI
 * schema. Surfaced via the `requiredScopes` field of the per-method
 * spec so a 401 or 403 ApiError is upgraded to a `PermissionError`
 * naming the missing scope. Only `:read` is required as the
 * minimum-privilege scope for this read-only operation.
 */
export const LIST_LOGS_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"universe.place.luau-execution-session:read",
]);
