import type { RequestOptions } from "../../client/types.ts";
import { buildRestartServersRequest } from "../../domains/cloud-v2/universes/builders.ts";
import {
	RESTART_OPERATION_LIMIT,
	RESTART_REQUIRED_SCOPES,
} from "../../domains/cloud-v2/universes/operations.ts";
import type { RestartUniverseServersParameters } from "../../domains/cloud-v2/universes/types.ts";
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
import {
	type OutdatedSelection,
	selectOutdatedPlaces,
	summarizeOutdatedRestart,
} from "../../domains/server-management/restarts/select-outdated.ts";
import type {
	ForecastRestartParameters,
	LaunchedRestart,
	LaunchRestartParameters,
	ListRestartsParameters,
	OutdatedRestart,
	PlaceRestartForecast,
	RestartOutdatedParameters,
	RestartStatus,
} from "../../domains/server-management/restarts/types.ts";
import { ApiError } from "../../errors/api-error.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import {
	parseEmptyResponse,
	type ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
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

// Unlike `LAUNCH_SPEC`, this restart is safe to repeat: it selects only
// servers on an older place version, so a repeat closes only servers that
// are still outdated. So a 429, 502, 503 or 504 is retried. A 500 is not:
// Roblox answers a steady 500 when a listed place has no live server, so
// `restartOutdated` reads the forecast again instead of spending backed-off
// retries on it. `methodKind: "create"` makes these defaults win over the
// client-level retry config, whose default retries a 500; a per-request
// override still wins. It shares the `restartServers` operation key, and so
// its rate-limit queue.
const RESTART_OUTDATED_SPEC = makeSpec<RestartUniverseServersParameters, undefined>({
	buildRequest: buildRestartServersRequest,
	methodDefaults: Object.freeze({
		retryableStatuses: Object.freeze([429, 502, 503, 504] as const),
		retryableTransportCodes: IDEMPOTENT_METHOD_DEFAULTS.retryableTransportCodes,
	}),
	methodKind: "create",
	operationLimit: RESTART_OPERATION_LIMIT,
	parse: parseEmptyResponse,
	requiredScopes: RESTART_REQUIRED_SCOPES,
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
 * restart endpoints: preview a restart, launch one, and track it. Its
 * `restartOutdated` also uses the universe `:restartServers` method. The
 * server-management endpoints are BETA on the Roblox side.
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
	 * which `list` reports while the restart runs. When no live server
	 * matches, Roblox records no restart and `id` is `undefined`.
	 *
	 * @example
	 * ```ts
	 * import { createFakeHttpClient } from "@bedrock-rbx/ocale/testing";
	 * import { UniversesClient } from "@bedrock-rbx/ocale/universes";
	 *
	 * const httpClient = createFakeHttpClient().mockResponse({
	 *   body: {
	 *     id: "00000000-0000-0000-0000-000000000000",
	 *     instancesImpacted: 0,
	 *     playersImpacted: 0,
	 *   },
	 *   status: 200,
	 * });
	 * const client = new UniversesClient({
	 *   credential: { apiKey: "your-key", kind: "apiKey" },
	 *   httpClient,
	 * });
	 *
	 * return client.restarts
	 *   .launch({ bleedOffDurationMinutes: 5, universeId: "42" })
	 *   .then((result) => {
	 *     expect(result).toEqual({
	 *       data: { id: undefined, instancesImpacted: 0, playersImpacted: 0 },
	 *       success: true,
	 *     });
	 *   });
	 * ```
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

	/**
	 * Restarts only the servers that run an older version of the given
	 * places, for example after a publish. It reads the forecast
	 * (`universe:read`), keeps each place with at least one outdated
	 * server, and sends one `:restartServers` call (`universe:write`) for
	 * them. When no place has an outdated server, it sends no restart.
	 *
	 * Roblox answers a 500 when any listed place has no live server, which
	 * happens when a place loses its last outdated server between the
	 * forecast and the restart. On that 500 it reads the forecast once more
	 * and sends one more restart for the places still outdated. A 502, 503
	 * or 504 on the restart is retried. The selection relies on the
	 * forecast's `instancesImpacted` counting only servers on an older
	 * version, which live captures show but Roblox does not document.
	 *
	 * @example
	 * ```ts
	 * import { createFakeHttpClient } from "@bedrock-rbx/ocale/testing";
	 * import { UniversesClient } from "@bedrock-rbx/ocale/universes";
	 *
	 * const httpClient = createFakeHttpClient()
	 *   .mockResponse({
	 *     body: {
	 *       placeForecasts: {
	 *         111: {
	 *           instancesImpacted: 2,
	 *           instancesPerVersion: { 5: 2, 6: 1 },
	 *           isNotInUniverse: false,
	 *           latestPlaceVersion: "6",
	 *           playersImpacted: 4,
	 *           playersPerVersion: { 5: 4, 6: 1 },
	 *           publishTime: "2026-04-24T02:36:28.673Z",
	 *           totalInstances: 3,
	 *           totalPlayers: 5,
	 *         },
	 *       },
	 *     },
	 *     status: 200,
	 *   })
	 *   .mockResponse({ body: {}, status: 200 });
	 * const client = new UniversesClient({
	 *   credential: { apiKey: "your-key", kind: "apiKey" },
	 *   httpClient,
	 * });
	 *
	 * return client.restarts
	 *   .restartOutdated({ placeIds: ["111", "222"], universeId: "42" })
	 *   .then((result) => {
	 *     expect(result).toEqual({
	 *       data: {
	 *         places: [
	 *           { instancesImpacted: 2, placeId: "111", restarted: true },
	 *           { instancesImpacted: 0, placeId: "222", restarted: false },
	 *         ],
	 *         restarted: true,
	 *       },
	 *       success: true,
	 *     });
	 *   });
	 * ```
	 *
	 * @param parameters - The universe and the places to check.
	 * @param options - Optional per-request overrides, applied to every
	 *   request.
	 * @returns A {@link Result} wrapping the {@link OutdatedRestart}, or
	 *   the {@link OpenCloudError} that caused a request to fail.
	 */
	public async restartOutdated(
		{ placeIds, universeId }: RestartOutdatedParameters,
		options?: RequestOptions,
	): Promise<Result<OutdatedRestart, OpenCloudError>> {
		// Built only to validate `placeIds` before the forecast; then discarded.
		const validated = buildRestartServersRequest({ placeIds, universeId });
		if (!validated.success) {
			return validated;
		}

		let selection = await this.#selectOutdated({ placeIds, universeId }, options);
		if (!selection.success) {
			return selection;
		}

		let restart = await this.#restartSelected(
			{ placeIds: selection.data.placeIds, universeId },
			options,
		);
		if (!restart.success && restart.err instanceof ApiError && restart.err.statusCode === 500) {
			selection = await this.#selectOutdated({ placeIds, universeId }, options);
			if (!selection.success) {
				return selection;
			}

			restart = await this.#restartSelected(
				{ placeIds: selection.data.placeIds, universeId },
				options,
			);
		}

		const restarted = selection.data.placeIds.length > 0;
		return restart.success
			? { data: summarizeOutdatedRestart(selection.data, restarted), success: true }
			: restart;
	}

	async #restartSelected(
		parameters: RestartOutdatedParameters,
		options: RequestOptions | undefined,
	): Promise<Result<undefined, OpenCloudError>> {
		if (parameters.placeIds.length === 0) {
			return { data: undefined, success: true };
		}

		return this.#inner.executeAsync({ options, parameters, spec: RESTART_OUTDATED_SPEC });
	}

	async #selectOutdated(
		{ placeIds, universeId }: RestartOutdatedParameters,
		options: RequestOptions | undefined,
	): Promise<Result<OutdatedSelection, OpenCloudError>> {
		const forecast = await this.forecast({ universeId }, options);
		if (!forecast.success) {
			return forecast;
		}

		return { data: selectOutdatedPlaces(placeIds, forecast.data), success: true };
	}
}
