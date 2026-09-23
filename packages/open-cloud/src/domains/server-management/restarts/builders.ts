import type { HttpRequest } from "../../../client/types.ts";
import type { OpenCloudError } from "../../../errors/base.ts";
import { okRequest } from "../../../internal/resource-client.ts";
import type { Result } from "../../../types.ts";
import type { ForecastRestartParameters } from "./types.ts";

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
