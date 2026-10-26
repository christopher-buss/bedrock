import type { OpenCloudError } from "../../../errors/base.ts";
import type { HttpRequest } from "../../../internal/http/types.ts";
import { okRequest } from "../../../internal/resource-client.ts";
import type { Result } from "../../../types.ts";
import type { ActivateUniverseParameters, DeactivateUniverseParameters } from "./types.ts";

/**
 * Builds the Open Cloud experience activation request.
 * @param parameters - The universe identifier.
 * @returns The POST request wrapped in a success Result.
 */
export function buildActivateRequest(
	parameters: ActivateUniverseParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest({
		method: "POST",
		url: `/legacy-develop/v1/universes/${parameters.universeId}/activate`,
	});
}

/**
 * Builds the Open Cloud experience deactivation request.
 * @param parameters - The universe identifier.
 * @returns The POST request wrapped in a success Result.
 */
export function buildDeactivateRequest(
	parameters: DeactivateUniverseParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest({
		method: "POST",
		url: `/legacy-develop/v1/universes/${parameters.universeId}/deactivate`,
	});
}
