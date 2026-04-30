import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

/**
 * Per-second request ceiling for every game-icon Operation bound on
 * `UniversesClient.icon`. The legacy `gameinternationalization` service caps
 * each API key at 100 requests per minute *shared across the entire service*
 * (see the `x-roblox-rate-limits` extension on every operation in the
 * vendored Open Cloud spec), so all methods queue against the same operation
 * key.
 */
export const ICON_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: 100 / 60,
	operationKey: "experience-icon",
});
