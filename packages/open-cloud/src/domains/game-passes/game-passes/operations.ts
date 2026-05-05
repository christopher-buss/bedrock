import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

/**
 * Per-second request ceiling for reading a single game pass, from the
 * Open Cloud OpenAPI schema.
 */
export const GET_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 10,
	operationKey: "game-passes.get",
});

/**
 * Per-second request ceiling for creating a game pass, from the Open
 * Cloud OpenAPI schema.
 */
export const CREATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 5,
	operationKey: "game-passes.create",
});

/**
 * Per-second request ceiling for updating a game pass, from the Open
 * Cloud OpenAPI schema. Keyed independently from
 * {@link CREATE_OPERATION_LIMIT} so create and update do not share a
 * queue, since the schema does not document the per-second quota as
 * shared between the POST and PATCH endpoints.
 */
export const UPDATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 5,
	operationKey: "game-passes.update",
});

/**
 * Per-second request ceiling for listing game passes for a universe,
 * from the Open Cloud OpenAPI schema.
 */
export const LIST_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 10,
	operationKey: "game-passes.list",
});

/**
 * Scopes required to read a game pass, sourced from `x-roblox-scopes`
 * on the `GamePasses_GetGamePassConfig` operation in the vendored
 * OpenAPI schema.
 */
export const GET_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze(["game-pass:read"]);

/**
 * Scopes required to create a game pass, sourced from `x-roblox-scopes`
 * on the `GamePasses_CreateGamePass` operation in the vendored OpenAPI
 * schema.
 */
export const CREATE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze(["game-pass:write"]);

/**
 * Scopes required to update a game pass, sourced from `x-roblox-scopes`
 * on the `GamePasses_UpdateGamePass` operation in the vendored OpenAPI
 * schema.
 */
export const UPDATE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze(["game-pass:write"]);

/**
 * Scopes required to list game passes for a universe, sourced from
 * `x-roblox-scopes` on the `GamePasses_ListGamePassConfigsByUniverse`
 * operation in the vendored OpenAPI schema.
 */
export const LIST_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze(["game-pass:read"]);
