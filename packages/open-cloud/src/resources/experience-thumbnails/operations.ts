import type { OperationLimit } from "../../internal/http/rate-limit-queue.ts";

// Roblox does not publish per-second ceilings for the legacy
// `gameinternationalization` endpoints. The values below are tuned to match
// the conservative defaults used elsewhere in this package and should be
// revisited if production traces show persistent 429s.

/**
 * Per-second request ceiling for uploading an experience thumbnail.
 */
export const UPLOAD_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 5,
	operationKey: "experience-thumbnails.upload",
});

/**
 * Per-second request ceiling for deleting an experience thumbnail.
 */
export const DELETE_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 5,
	operationKey: "experience-thumbnails.delete",
});

/**
 * Per-second request ceiling for reordering experience thumbnails.
 */
export const REORDER_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 5,
	operationKey: "experience-thumbnails.reorder",
});
