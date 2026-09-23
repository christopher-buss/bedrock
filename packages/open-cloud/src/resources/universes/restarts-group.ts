import type { RequestOptions } from "../../client/types.ts";
import {
	buildForecastRequest,
	buildLaunchRequest,
	buildListRequest,
} from "../../domains/server-management/restarts/builders.ts";
import {
	FORECAST_OPERATION_LIMIT,
	LAUNCH_OPERATION_LIMIT,
	LAUNCH_REQUIRED_SCOPES,
	LIST_OPERATION_LIMIT,
	READ_REQUIRED_SCOPES,
} from "../../domains/server-management/restarts/operations.ts";
import {
	parseForecastResponse,
	parseLaunchResponse,
	parseListResponse,
} from "../../domains/server-management/restarts/parsers.ts";
import type {
	ForecastRestartParameters,
	LaunchedRestart,
	LaunchRestartParameters,
	ListRestartsParameters,
	PlaceRestartForecast,
	RestartStatus,
} from "../../domains/server-management/restarts/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import type { ResourceClient, ResourceMethodSpec } from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";

function makeSpec<P, R>(spec: ResourceMethodSpec<P, R>): ResourceMethodSpec<P, R> {
	return Object.freeze(spec);
}

const FORECAST_SPEC = makeSpec<ForecastRestartParameters, ReadonlyArray<PlaceRestartForecast>>({
	buildRequest: buildForecastRequest,
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: FORECAST_OPERATION_LIMIT,
	parse: parseForecastResponse,
	requiredScopes: READ_REQUIRED_SCOPES,
});

// A launch is not safe to repeat: a 5xx may follow an accepted restart,
// and Roblox answers some requests with a steady 500 (see
// docs/spikes/restart-servers). So the retry policy mirrors `create`.
const LAUNCH_SPEC = makeSpec<LaunchRestartParameters, LaunchedRestart>({
	buildRequest: buildLaunchRequest,
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: LAUNCH_OPERATION_LIMIT,
	parse: parseLaunchResponse,
	requiredScopes: LAUNCH_REQUIRED_SCOPES,
});

const LIST_SPEC = makeSpec<ListRestartsParameters, ReadonlyArray<RestartStatus>>({
	buildRequest: buildListRequest,
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: LIST_OPERATION_LIMIT,
	parse: parseListResponse,
	requiredScopes: READ_REQUIRED_SCOPES,
});

/**
 * Operation Group on `UniversesClient` that exposes the server-management
 * restart endpoints: preview a restart, launch one, and track it. The
 * endpoints are BETA on the Roblox side.
 */
export class UniverseRestartsGroup {
	readonly #inner: ResourceClient;

	/**
	 * Wraps the shared {@link ResourceClient} so the Operation Group
	 * routes calls through the same retry, hooks, and rate-limit queues
	 * as the rest of the parent client.
	 *
	 * @param inner - The shared {@link ResourceClient} owned by the
	 *   parent client.
	 */
	constructor(inner: ResourceClient) {
		this.#inner = inner;
	}

	/**
	 * Reads the live servers of every active place in a universe, and how
	 * many of them a restart of old place versions would close.
	 *
	 * @param parameters - The universe identifier.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping one {@link PlaceRestartForecast}
	 *   per active place (empty when no server runs), or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async forecast(
		parameters: ForecastRestartParameters,
		options?: RequestOptions,
	): Promise<Result<ReadonlyArray<PlaceRestartForecast>, OpenCloudError>> {
		return this.#inner.executeAsync({ options, parameters, spec: FORECAST_SPEC });
	}

	/**
	 * Launches a restart of a universe's live servers and returns its ID,
	 * which `list` reports while the restart runs.
	 *
	 * @param parameters - The universe identifier.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping the {@link LaunchedRestart}, or
	 *   the {@link OpenCloudError} that caused the request to fail.
	 */
	public async launch(
		parameters: LaunchRestartParameters,
		options?: RequestOptions,
	): Promise<Result<LaunchedRestart, OpenCloudError>> {
		return this.#inner.executeAsync({ options, parameters, spec: LAUNCH_SPEC });
	}

	/**
	 * Lists a universe's restarts with their progress per place. A
	 * `:restartServers` call that selected a server appears here too, but
	 * only `launch` returns the ID to match it by.
	 *
	 * @param parameters - The universe identifier.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping one {@link RestartStatus} per
	 *   restart, or the {@link OpenCloudError} that caused the request to
	 *   fail.
	 */
	public async list(
		parameters: ListRestartsParameters,
		options?: RequestOptions,
	): Promise<Result<ReadonlyArray<RestartStatus>, OpenCloudError>> {
		return this.#inner.executeAsync({ options, parameters, spec: LIST_SPEC });
	}
}
