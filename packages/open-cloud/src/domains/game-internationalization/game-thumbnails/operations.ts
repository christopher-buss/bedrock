import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

/**
 * Per-second request ceiling for game-thumbnails Operations on
 * `UniversesClient.thumbnails`, from each operation's
 * `x-roblox-rate-limits.perApiKeyOwner` in the vendored schema (100 requests
 * per minute). This family's key stays separate from other
 * game-internationalization families: the #587 probe measured independent
 * reported 100/minute counters on rejected requests. Successful writes may
 * have additional service limits; see
 * `docs/spikes/game-internationalization-rate-limits/README.md`.
 */
export const THUMBNAILS_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 100 / 60,
	operationKey: "experience-thumbnails",
});

/**
 * Scopes required for every game-thumbnails operation, sourced from
 * `x-roblox-scopes` on the legacy `gameinternationalization` thumbnail
 * endpoints in the vendored OpenAPI schema.
 */
export const THUMBNAILS_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze([
	"legacy-universe:manage",
]);
