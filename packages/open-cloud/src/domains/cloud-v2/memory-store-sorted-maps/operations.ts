import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const CREATE_PER_MINUTE = 1_000_000;
const SECONDS_PER_MINUTE = 60;

/**
 * Per-second request ceiling for creating a memory-store sorted-map
 * item, from the Open Cloud OpenAPI schema (1,000,000 requests per
 * minute per API key owner). Keyed independently from the get, update,
 * delete, and list operations so the five do not share a queue.
 */
export const CREATE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: CREATE_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "memory-store-sorted-maps.create",
});

/**
 * Scopes required to create a memory-store sorted-map item, sourced
 * from `x-roblox-scopes` on the `Cloud_CreateMemoryStoreSortedMapItem`
 * operation in the vendored OpenAPI schema.
 */
export const CREATE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"memory-store.sorted-map:write",
]);

const DELETE_PER_MINUTE = 1_000_000;

/**
 * Per-second request ceiling for deleting a memory-store sorted-map
 * item, from the Open Cloud OpenAPI schema (1,000,000 requests per
 * minute per API key owner).
 */
export const DELETE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: DELETE_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "memory-store-sorted-maps.delete",
});

/**
 * Scopes required to delete a memory-store sorted-map item, sourced
 * from `x-roblox-scopes` on the `Cloud_DeleteMemoryStoreSortedMapItem`
 * operation in the vendored OpenAPI schema.
 */
export const DELETE_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"memory-store.sorted-map:write",
]);

const GET_PER_MINUTE = 1_000_000;

/**
 * Per-second request ceiling for reading a memory-store sorted-map
 * item, from the Open Cloud OpenAPI schema (1,000,000 requests per
 * minute per API key owner).
 */
export const GET_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: GET_PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "memory-store-sorted-maps.get",
});

/**
 * Scopes required to read a memory-store sorted-map item, sourced from
 * `x-roblox-scopes` on the `Cloud_GetMemoryStoreSortedMapItem`
 * operation in the vendored OpenAPI schema.
 */
export const GET_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"memory-store.sorted-map:read",
]);
