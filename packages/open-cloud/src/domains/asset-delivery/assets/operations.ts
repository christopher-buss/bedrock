import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const PER_MINUTE = 1000;
const SECONDS_PER_MINUTE = 60;

/**
 * Request ceiling for `GET /asset-delivery-api/v1/assetId/{assetId}`, from the
 * vendored OpenAPI schema (1000 requests per minute per API key owner).
 */
export const DOWNLOAD_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "assets.download",
});

/** Scopes required by the asset delivery endpoint, from `x-roblox-scopes`. */
export const DOWNLOAD_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"legacy-asset:manage",
]);
