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
