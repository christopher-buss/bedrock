import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isDateTimeString } from "../../../internal/utils/is-date-time-string.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Result } from "../../../types.ts";
import type { LaunchedRestart, PlaceRestartForecast } from "./types.ts";
import type {
	ForecastRestartResponseWire,
	LaunchRestartResponseWire,
	PlaceSummaryForGameRestartWire,
} from "./wire.ts";

const MALFORMED_FORECAST_MESSAGE = "Malformed restart forecast response";

const MALFORMED_LAUNCH_MESSAGE = "Malformed restart launch response";

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
