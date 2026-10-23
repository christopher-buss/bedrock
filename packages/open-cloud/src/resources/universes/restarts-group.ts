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
import { selectOutdatedPlaces } from "../../domains/server-management/restarts/select-outdated.ts";
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
// servers on an older place version, so a second call after an accepted
// one closes nothing new. So a 5xx is retried. It shares the
// `restartServers` operation key, and so its rate-limit queue.
const RESTART_OUTDATED_SPEC = makeSpec<RestartUniverseServersParameters, undefined>({
	buildRequest: buildRestartServersRequest,
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
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
	 * places, for example after a publish. It reads the forecast first
	 * (`universe:read`), skips each place with no outdated server, and
	 * then calls `:restartServers` (`universe:write`) for the rest. When
	 * no place has an outdated server, it sends no restart, which avoids
	 * the 500 that Roblox returns for a place with no live server. A 5xx
	 * on the restart is retried. A server can still close between the
	 * forecast and the restart; Roblox can then answer with an error.
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
	 *       data: { instancesImpacted: 2, restarted: true },
	 *       success: true,
	 *     });
	 *   });
	 * ```
	 *
	 * @param parameters - The universe, the places to check, and an
	 *   optional bleed-off duration.
	 * @param options - Optional per-request overrides, applied to both
	 *   requests.
	 * @returns A {@link Result} wrapping the {@link OutdatedRestart}, or
	 *   the {@link OpenCloudError} that caused a request to fail.
	 */
	public async restartOutdated(
		{ placeIds, universeId, ...bleedOff }: RestartOutdatedParameters,
		options?: RequestOptions,
	): Promise<Result<OutdatedRestart, OpenCloudError>> {
		const validation = buildRestartServersRequest({ placeIds, universeId });
		if (!validation.success) {
			return validation;
		}

		const forecast = await this.forecast({ universeId }, options);
		if (!forecast.success) {
			return forecast;
		}

		const selection = selectOutdatedPlaces(placeIds, forecast.data);
		if (selection.placeIds.length === 0) {
			return { data: { instancesImpacted: 0, restarted: false }, success: true };
		}

		const restart = await this.#inner.executeAsync({
			options,
			parameters: { ...bleedOff, placeIds: selection.placeIds, universeId },
			spec: RESTART_OUTDATED_SPEC,
		});
		if (!restart.success) {
			return restart;
		}

		return {
			data: { instancesImpacted: selection.instancesImpacted, restarted: true },
			success: true,
		};
	}
}
