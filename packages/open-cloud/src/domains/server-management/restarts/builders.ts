import type { HttpRequest } from "../../../client/types.ts";
import type { OpenCloudError } from "../../../errors/base.ts";
import { okRequest } from "../../../internal/resource-client.ts";
import type { Result } from "../../../types.ts";
import type {
	ForecastRestartParameters,
	LaunchRestartParameters,
	ListRestartsParameters,
} from "./types.ts";

/**
 * Builds a `GET` request for the server-management restart forecast.
 *
 * @param parameters - The universe identifier.
 * @returns A success result wrapping the request; the builder cannot fail.
 */
export function buildForecastRequest(
	parameters: ForecastRestartParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest({
		method: "GET",
		url: `/server-management/v1/universes/${parameters.universeId}/restarts:forecast`,
	});
}

/**
 * Builds a `POST` request that launches a server-management restart. The
 * body is never omitted: the endpoint answers 415 to a POST without one.
 *
 * @param parameters - The universe identifier and restart selection.
 * @returns A success result wrapping the request; the builder cannot fail.
 */
export function buildLaunchRequest({
	universeId,
	...selection
}: LaunchRestartParameters): Result<HttpRequest, OpenCloudError> {
	return okRequest({
		body: selection,
		headers: { "content-type": "application/json" },
		method: "POST",
		url: `/server-management/v1/universes/${universeId}/restarts`,
	});
}

/**
 * Builds a `GET` request that lists a universe's server-management
 * restarts.
 *
 * @param parameters - The universe identifier.
 * @returns A success result wrapping the request; the builder cannot fail.
 */
export function buildListRequest(
	parameters: ListRestartsParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest({
		method: "GET",
		url: `/server-management/v1/universes/${parameters.universeId}/restarts`,
	});
}
