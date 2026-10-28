import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

/**
 * Per-second request ceiling for badge localization Operations, from each
 * operation's `x-roblox-rate-limits.perApiKeyOwner` in the vendored schema
 * (100 requests per minute). This family's key stays separate from other
 * game-internationalization families: the #587 probe measured independent
 * reported 100/minute counters, including on rejected requests. Successful
 * writes may have additional service limits; see
 * `docs/spikes/game-internationalization-rate-limits/README.md`.
 */
export const LOCALIZATION_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 100 / 60,
	operationKey: "badge-localization",
});

/**
 * Scopes required for every badge localization operation, sourced from
 * `x-roblox-scopes` on the legacy `gameinternationalization` badge
 * endpoints in the vendored OpenAPI schema.
 */
export const LOCALIZATION_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"legacy-badge:manage",
]);
