import type { OperationLimit } from "../../../internal/http/rate-limit-queue.ts";

const PER_MINUTE = 100;
const SECONDS_PER_MINUTE = 60;

/**
 * Per-second request ceiling for `Restarts_ForecastRestart`, from the
 * Open Cloud OpenAPI schema (100 requests per minute per API key owner).
 * Live headers show it metered apart from launch and list.
 */
export const FORECAST_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "restarts.forecast",
});

/**
 * Scopes required to read restart forecasts and statuses, sourced from
 * `x-roblox-scopes` on `Restarts_ForecastRestart` and
 * `Restarts_ListRestartStatuses` in the vendored OpenAPI schema.
 */
export const READ_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze(["universe:read"]);

/**
 * Per-second request ceiling for `Restarts_LaunchRestart`, from the Open
 * Cloud OpenAPI schema (100 requests per minute per API key owner).
 */
export const LAUNCH_OPERATION_LIMIT: OperationLimit = Object.freeze({
	maxPerSecond: PER_MINUTE / SECONDS_PER_MINUTE,
	operationKey: "restarts.launch",
});

/**
 * Scopes required to launch a restart, sourced from `x-roblox-scopes` on
 * `Restarts_LaunchRestart` in the vendored OpenAPI schema.
 */
export const LAUNCH_REQUIRED_SCOPES: ReadonlyArray<string> = Object.freeze(["universe:write"]);
