import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

/**
 * Per-second request ceiling for uploading a badge icon, sourced from
 * `x-roblox-rate-limits` on the legacy badge icon upload operation in
 * the vendored OpenAPI schema (100 per minute, per API key owner). Keyed
 * separately from the badges create and update buckets because Roblox
 * does not document the legacy-publish quota as shared with the
 * legacy-badges quota.
 */
export const UPLOAD_ICON_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 100 / 60,
	operationKey: "badges.upload-icon",
});

/**
 * Scopes the API key or OAuth token must carry to upload a badge icon,
 * sourced from `x-roblox-scopes` on the legacy badge icon upload
 * operation in the vendored OpenAPI schema.
 */
export const UPLOAD_ICON_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"legacy-badge:manage",
]);
