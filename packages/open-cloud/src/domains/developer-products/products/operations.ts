import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

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

/**
 * Per-second request ceiling for updating a developer product, from the
 * Open Cloud OpenAPI schema. Keyed independently from
 * {@link CREATE_OPERATION_LIMIT} so create and update do not share a queue,
 * since Roblox does not document the per-minute quota as shared between
 * the POST and PATCH endpoints.
 */
export const UPDATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 3,
	operationKey: "developer-products.update",
});

/**
 * Scopes the API key or OAuth token must carry to read a developer product,
 * sourced from `x-roblox-scopes` on the `DeveloperProducts_GetDeveloperProductConfigV2`
 * operation in the vendored OpenAPI schema.
 */
export const GET_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze(["developer-product:read"]);

/**
 * Scopes the API key or OAuth token must carry to create or update a developer
 * product, sourced from `x-roblox-scopes` on the
 * `DeveloperProducts_CreateDeveloperProductV2` and
 * `DeveloperProducts_UpdateDeveloperProductV2` operations in the vendored
 * OpenAPI schema.
 */
export const WRITE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"developer-product:write",
]);
