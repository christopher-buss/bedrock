import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

/**
 * Per-second request ceiling for creating a badge, sourced from
 * `x-roblox-rate-limits` on the legacy badges create operation in the
 * vendored OpenAPI schema (100 per minute, per API key owner).
 */
export const CREATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 100 / 60,
	operationKey: "badges.create",
});

/**
 * Per-second request ceiling for updating a badge, sourced from
 * `x-roblox-rate-limits` on the legacy badges update operation in the
 * vendored OpenAPI schema. Keyed independently from
 * {@link CREATE_OPERATION_LIMIT} so create and update do not share a
 * queue, since Roblox does not document the per-minute quota as shared
 * between the POST and PATCH endpoints.
 */
export const UPDATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 100 / 60,
	operationKey: "badges.update",
});

/**
 * Scopes the API key or OAuth token must carry to create a badge,
 * sourced from `x-roblox-scopes` on the legacy badges create operation
 * in the vendored OpenAPI schema. The trailing
 * `:manage-and-spend-robux` reflects that badge creation may charge a
 * Robux fee.
 */
export const CREATE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"legacy-universe.badge:manage-and-spend-robux",
]);

/**
 * Scopes the API key or OAuth token must carry to update a badge,
 * sourced from `x-roblox-scopes` on the legacy badges update operation
 * in the vendored OpenAPI schema.
 */
export const UPDATE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"legacy-universe.badge:write",
]);
