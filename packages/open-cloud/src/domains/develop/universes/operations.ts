import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

/**
 * OpenAPI specifies 100 requests per minute per API key owner or OAuth
 * authorization.
 */
export const ACTIVATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 100 / 60,
	operationKey: "universes.activate",
});

/**
 * OpenAPI specifies 100 requests per minute per API key owner or OAuth
 * authorization.
 */
export const DEACTIVATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 100 / 60,
	operationKey: "universes.deactivate",
});

/** Required scope declared by both experience visibility operations. */
export const ACTIVATION_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"legacy-universe:manage",
]);
