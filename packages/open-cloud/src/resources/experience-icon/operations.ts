import type { OperationLimit } from "../../internal/http/rate-limit-queue.ts";

// Roblox does not publish per-second ceilings for the legacy
// `gameinternationalization` endpoints. The values below are tuned to match
// the conservative defaults used elsewhere in this package and should be
// revisited if production traces show persistent 429s.

/**
 * Per-second request ceiling for uploading an experience icon.
 */
export const UPLOAD_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 5,
	operationKey: "experience-icon.upload",
});

/**
 * Per-second request ceiling for deleting a localized experience icon.
 */
export const DELETE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 5,
	operationKey: "experience-icon.delete",
});

/**
 * Per-second request ceiling for listing localized experience icons.
 */
export const LIST_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 10,
	operationKey: "experience-icon.list",
});
