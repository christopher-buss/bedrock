import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

/**
 * Per-second request ceiling for every game-thumbnails Operation bound on
 * `UniversesClient.thumbnails`. The legacy `gameinternationalization`
 * service caps each API key at 100 requests per minute *shared across the
 * entire service* (see the `x-roblox-rate-limits` extension on every
 * operation in the vendored Open Cloud spec), so all methods queue against
 * the same operation key.
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
