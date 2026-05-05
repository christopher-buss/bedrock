import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

/**
 * Per-second request ceiling for every developer-product localization
 * Operation. Identical to the constant exported from the sibling
 * `developer-product-name-description` module: both endpoints share the
 * 100-requests-per-minute cap on the legacy `gameinternationalization`
 * service, and queue under the same operation key so a burst across both
 * methods respects the shared upstream budget.
 */
export const LOCALIZATION_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 100 / 60,
	operationKey: "developer-product-localization",
});

/**
 * Scopes required for every developer-product localization operation, sourced
 * from `x-roblox-scopes` on the legacy `gameinternationalization`
 * developer-product endpoints in the vendored OpenAPI schema.
 */
export const LOCALIZATION_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"legacy-developer-product:manage",
]);
