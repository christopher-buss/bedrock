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

const RESTART_STATES: ReadonlySet<unknown> = new Set(["DELAYING", "RESTARTING", "SUCCEEDED"]);

/** The ID Roblox returns from a launch that matched no live server. */
const NIL_RESTART_ID = "00000000-0000-0000-0000-000000000000";

interface MalformedBody {
	readonly body: unknown;
	readonly statusCode: number;
}

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
		return malformed("Malformed restart forecast response", { body, statusCode });
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
		return malformed("Malformed restart launch response", { body, statusCode });
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
		return malformed("Malformed restart list response", { body, statusCode });
	}

	const restarts = Object.entries(body.restartStatuses ?? {}).map(([id, status]) => {
		return toRestartStatus(id, status);
	});
	return { data: restarts, success: true };
}

function malformed(message: string, { body, statusCode }: MalformedBody): Result<never, ApiError> {
	return {
		err: new ApiError(message, { details: toJsonDetails(body), statusCode }),
		success: false,
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

/**
 * Whether a nullable wire field carries no value: absent, `undefined`, or
 * JSON `null`.
 *
 * @param value - The wire value.
 * @returns `true` when the field carries no value.
 */
function isAbsent(value: unknown): boolean {
	return (value ?? undefined) === undefined;
}

function isOptional(value: unknown, isPresent: (present: unknown) => boolean): boolean {
	return isAbsent(value) || isPresent(value);
}

function isOptionalRecordOf(value: unknown, isEntry: (entry: unknown) => boolean): boolean {
	return isOptional(value, (record) => isRecord(record) && Object.values(record).every(isEntry));
}

function isNumber(value: unknown): boolean {
	return typeof value === "number";
}

function isString(value: unknown): boolean {
	return typeof value === "string";
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
		isOptional(value["latestPlaceVersion"], isString) &&
		isOptionalRecordOf(value["instancesPerVersion"], isNumber) &&
		isOptionalRecordOf(value["playersPerVersion"], isNumber)
	);
}

function isForecastWire(body: unknown): body is ForecastRestartResponseWire {
	return isRecord(body) && isOptionalRecordOf(body["placeForecasts"], isPlaceSummaryWire);
}

function isLaunchWire(body: unknown): body is LaunchRestartResponseWire {
	return (
		isRecord(body) &&
		isOptional(body["id"], isString) &&
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

function isVersions(value: unknown): boolean {
	return Array.isArray(value) && value.every(isNumber);
}

function isFilterWire(value: unknown): boolean {
	return (
		isRecord(value) &&
		isOptional(value["excludeCurrentVersion"], (exclude) => typeof exclude === "boolean") &&
		isOptional(value["versions"], isVersions)
	);
}

function isPlaceStatusWire(value: unknown): value is PlaceRestartStatusWire {
	return (
		isRecord(value) &&
		RESTART_STATES.has(value["state"]) &&
		isDateTimeString(value["startTime"]) &&
		isOptional(value["endTime"], isDateTimeString) &&
		typeof value["totalPlayers"] === "number" &&
		typeof value["totalInstances"] === "number" &&
		typeof value["remainingPlayers"] === "number" &&
		typeof value["remainingInstances"] === "number" &&
		isOptional(value["filter"], isFilterWire) &&
		isOptional(value["latestVersion"], isString)
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
