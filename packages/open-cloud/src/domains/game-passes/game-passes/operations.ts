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
