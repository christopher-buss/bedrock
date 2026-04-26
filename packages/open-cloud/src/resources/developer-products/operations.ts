import type { OperationLimit } from "../../internal/http/rate-limit-queue.ts";

/**
 * Per-second request ceiling for reading a single developer product, from
 * the Open Cloud OpenAPI schema.
 */
export const GET_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 10,
	operationKey: "developer-products.get",
});

/**
 * Per-second request ceiling for creating a developer product, from the
 * Open Cloud OpenAPI schema.
 */
export const CREATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 3,
	operationKey: "developer-products.create",
});
