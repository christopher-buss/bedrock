import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const SUBMIT_AT_HEAD_PER_MINUTE = 40;
const SUBMIT_AT_VERSION_PER_MINUTE = 5;
const GET_PER_MINUTE = 200;
const SECONDS_PER_MINUTE = 60;

/**
 * Per-second request ceiling for submitting a Luau execution task at a
 * place's head version, sourced from
 * `x-roblox-rate-limits.perApiKeyOwner` on the
 * `Cloud_CreateLuauExecutionSessionTask__Using_Universes` operation
 * (40 requests per minute per API key owner), which is also the burst
 * the server allows. The operation's prose description claims 5 per
 * minute; the machine-readable extension is the enforced figure.
 */
export const SUBMIT_HEAD_OPERATION_LIMIT: OperationLimit = Object.freeze({
	burstCapacity: SUBMIT_AT_HEAD_PER_MINUTE,
	maxPerSecond: SUBMIT_AT_HEAD_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "luau-execution-tasks.submit",
});

/**
 * Per-second request ceiling for submitting a Luau execution task at a
 * specific place version, sourced from
 * `x-roblox-rate-limits.perApiKeyOwner` on the
 * `Cloud_CreateLuauExecutionSessionTask__Using_Universes_Places`
 * operation (5 requests per minute per API key owner), which is also
 * the burst the server allows. Carries its own operation key so the
 * version-pinned URL shape is paced from its own quota: the server
 * meters the two shapes in separate buckets whose ceilings are
 * additive, and pinned traffic does not consume head budget.
 */
export const SUBMIT_VERSION_OPERATION_LIMIT: OperationLimit = Object.freeze({
	burstCapacity: SUBMIT_AT_VERSION_PER_MINUTE,
	maxPerSecond: SUBMIT_AT_VERSION_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "luau-execution-tasks.submit-at-version",
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
