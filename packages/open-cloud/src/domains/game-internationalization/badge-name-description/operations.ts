import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

/**
 * Per-second request ceiling for every badge localization Operation. The
 * legacy `gameinternationalization` service caps each API key at 100
 * requests per minute *shared across the entire service* (see the
 * `x-roblox-rate-limits` extension on every operation in the vendored
 * Open Cloud spec), so all badge localization methods queue against the
 * same operation key.
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
