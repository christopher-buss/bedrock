import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isDateTimeString } from "../../../internal/utils/is-date-time-string.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Result } from "../../../types.ts";
import type {
	LaunchedRestart,
	PlaceRestartForecast,
	PlaceRestartStatus,
	RestartPlaceFilter,
	RestartStatus,
} from "./types.ts";
import type {
	ForecastRestartResponseWire,
	LaunchRestartResponseWire,
	ListRestartStatusesResponseWire,
	PlaceFilterWire,
	PlaceRestartStatusWire,
	PlaceSummaryForGameRestartWire,
	RestartStatusWire,
} from "./wire.ts";

const MALFORMED_FORECAST_MESSAGE = "Malformed restart forecast response";

const MALFORMED_LAUNCH_MESSAGE = "Malformed restart launch response";

const MALFORMED_LIST_MESSAGE = "Malformed restart list response";

const RESTART_STATES: ReadonlySet<unknown> = new Set(["DELAYING", "RESTARTING", "SUCCEEDED"]);

/** The ID Roblox returns from a launch that matched no live server. */
const NIL_RESTART_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Parses a `ForecastRestartResponse` body into one
 * {@link PlaceRestartForecast} per place.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the forecasts, or an {@link ApiError}
 *   when the body does not match the wire schema.
 */
export function parseForecastResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<ReadonlyArray<PlaceRestartForecast>, ApiError> {
	if (!isForecastWire(body)) {
		return {
			err: new ApiError(MALFORMED_FORECAST_MESSAGE, {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	const forecasts = Object.entries(body.placeForecasts ?? {}).map(([placeId, summary]) => {
		return toForecast(placeId, summary);
	});
	return { data: forecasts, success: true };
}

/**
 * Parses a `LaunchRestartResponse` body into a {@link LaunchedRestart}.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the launched restart, or an
 *   {@link ApiError} when the body does not match the wire schema.
 */
export function parseLaunchResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<LaunchedRestart, ApiError> {
	if (!isLaunchWire(body)) {
		return {
			err: new ApiError(MALFORMED_LAUNCH_MESSAGE, {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	return {
		data: {
			id: body.id === NIL_RESTART_ID ? undefined : (body.id ?? undefined),
			instancesImpacted: body.instancesImpacted,
			playersImpacted: body.playersImpacted,
		},
		success: true,
	};
}

/**
 * Parses a `ListRestartStatusesResponse` body into one
 * {@link RestartStatus} per restart.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the restarts, or an {@link ApiError}
 *   when the body does not match the wire schema.
 */
export function parseListResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<ReadonlyArray<RestartStatus>, ApiError> {
	if (!isListWire(body)) {
		return {
			err: new ApiError(MALFORMED_LIST_MESSAGE, {
				details: toJsonDetails(body),
				statusCode,
			}),
			success: false,
		};
	}

	const restarts = Object.entries(body.restartStatuses ?? {}).map(([id, status]) => {
		return toRestartStatus(id, status);
	});
	return { data: restarts, success: true };
}

function toForecast(
	placeId: string,
	summary: PlaceSummaryForGameRestartWire,
): PlaceRestartForecast {
	return {
		instancesImpacted: summary.instancesImpacted,
		instancesPerVersion: summary.instancesPerVersion ?? {},
		isNotInUniverse: summary.isNotInUniverse,
		latestPlaceVersion: summary.latestPlaceVersion ?? undefined,
		placeId,
		playersImpacted: summary.playersImpacted,
		playersPerVersion: summary.playersPerVersion ?? {},
		publishedAt: new Date(summary.publishTime),
		totalInstances: summary.totalInstances,
		totalPlayers: summary.totalPlayers,
	};
}

function isOptionalCountMap(value: unknown): boolean {
	if (value === undefined || value === null) {
		return true;
	}

	return isRecord(value) && Object.values(value).every((count) => typeof count === "number");
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || value === null || typeof value === "string";
}

function isPlaceSummaryWire(value: unknown): value is PlaceSummaryForGameRestartWire {
	return (
		isRecord(value) &&
		typeof value["instancesImpacted"] === "number" &&
		typeof value["isNotInUniverse"] === "boolean" &&
		typeof value["playersImpacted"] === "number" &&
		isDateTimeString(value["publishTime"]) &&
		typeof value["totalInstances"] === "number" &&
		typeof value["totalPlayers"] === "number" &&
		isOptionalString(value["latestPlaceVersion"]) &&
		isOptionalCountMap(value["instancesPerVersion"]) &&
		isOptionalCountMap(value["playersPerVersion"])
	);
}

function isForecastWire(body: unknown): body is ForecastRestartResponseWire {
	if (!isRecord(body)) {
		return false;
	}

	const { placeForecasts } = body;
	if (placeForecasts === undefined || placeForecasts === null) {
		return true;
	}

	return isRecord(placeForecasts) && Object.values(placeForecasts).every(isPlaceSummaryWire);
}

function isLaunchWire(body: unknown): body is LaunchRestartResponseWire {
	return (
		isRecord(body) &&
		isOptionalString(body["id"]) &&
		typeof body["instancesImpacted"] === "number" &&
		typeof body["playersImpacted"] === "number"
	);
}

function toFilter(filter: PlaceFilterWire | undefined): RestartPlaceFilter | undefined {
	const wire = filter ?? undefined;
	if (wire === undefined) {
		return undefined;
	}

	const versions = wire.versions ?? undefined;
	if (versions !== undefined) {
		return { versions };
	}

	const excludeCurrentVersion = wire.excludeCurrentVersion ?? undefined;
	return excludeCurrentVersion === undefined ? {} : { excludeCurrentVersion };
}

function toPlaceStatus(placeId: string, wire: PlaceRestartStatusWire): PlaceRestartStatus {
	return {
		endedAt: typeof wire.endTime === "string" ? new Date(wire.endTime) : undefined,
		filter: toFilter(wire.filter),
		latestVersion: wire.latestVersion ?? undefined,
		placeId,
		remainingInstances: wire.remainingInstances,
		remainingPlayers: wire.remainingPlayers,
		startedAt: new Date(wire.startTime),
		state: wire.state,
		totalInstances: wire.totalInstances,
		totalPlayers: wire.totalPlayers,
	};
}

function toRestartStatus(id: string, wire: RestartStatusWire): RestartStatus {
	const places = Object.entries(wire.placeRestartStatuses ?? {}).map(([placeId, status]) => {
		return toPlaceStatus(placeId, status);
	});
	return {
		id,
		places,
		scheduledAt: new Date(wire.scheduledTime),
		startsAt: new Date(wire.startTime),
	};
}

function isOptionalRecordOf(value: unknown, isEntry: (entry: unknown) => boolean): boolean {
	if (value === undefined || value === null) {
		return true;
	}

	return isRecord(value) && Object.values(value).every(isEntry);
}

function isOptionalDateTime(value: unknown): boolean {
	return value === undefined || value === null || isDateTimeString(value);
}

function isOptionalVersions(value: unknown): boolean {
	if (value === undefined || value === null) {
		return true;
	}

	return Array.isArray(value) && value.every((version) => typeof version === "number");
}

function isOptionalFilter(value: unknown): boolean {
	if (value === undefined || value === null) {
		return true;
	}

	if (!isRecord(value)) {
		return false;
	}

	const exclude = value["excludeCurrentVersion"];
	const isExcludeValid =
		exclude === undefined || exclude === null || typeof exclude === "boolean";
	return isExcludeValid && isOptionalVersions(value["versions"]);
}

function isPlaceStatusWire(value: unknown): value is PlaceRestartStatusWire {
	return (
		isRecord(value) &&
		RESTART_STATES.has(value["state"]) &&
		isDateTimeString(value["startTime"]) &&
		isOptionalDateTime(value["endTime"]) &&
		typeof value["totalPlayers"] === "number" &&
		typeof value["totalInstances"] === "number" &&
		typeof value["remainingPlayers"] === "number" &&
		typeof value["remainingInstances"] === "number" &&
		isOptionalFilter(value["filter"]) &&
		isOptionalString(value["latestVersion"])
	);
}

function isRestartStatusWire(value: unknown): value is RestartStatusWire {
	return (
		isRecord(value) &&
		isDateTimeString(value["scheduledTime"]) &&
		isDateTimeString(value["startTime"]) &&
		isOptionalRecordOf(value["placeRestartStatuses"], isPlaceStatusWire)
	);
}

function isListWire(body: unknown): body is ListRestartStatusesResponseWire {
	return isRecord(body) && isOptionalRecordOf(body["restartStatuses"], isRestartStatusWire);
}
