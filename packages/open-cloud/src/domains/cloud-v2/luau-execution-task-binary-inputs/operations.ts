import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const CREATE_PER_MINUTE = 5;
const SECONDS_PER_MINUTE = 60;

/**
 * Per-second request ceiling for creating a Luau execution task binary
 * input, sourced from `x-roblox-rate-limits.perApiKeyOwner` on the
 * `Cloud_CreateLuauExecutionSessionTaskBinaryInput` operation (5 requests
 * per minute per API key owner).
 */
export const CREATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: CREATE_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "luau-execution-task-binary-inputs.create",
});

/**
 * Scopes required to create a Luau execution task binary input, sourced
 * from `x-roblox-scopes` on the create operation in the vendored OpenAPI
 * schema.
 */
export const CREATE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"universe.place.luau-execution-session:write",
]);
