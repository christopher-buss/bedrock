import type { HttpRequest } from "../../../client/types.ts";
import type { SubmitAtHeadParameters } from "./types.ts";

/**
 * Builds a `POST` request for the Open Cloud "create Luau execution
 * session task" endpoint, targeting the place's head version. Serializes
 * `timeoutSeconds` into the wire's duration string format (`"<n>s"`)
 * when supplied.
 *
 * @param parameters - Universe and place identifiers, the script body,
 *   and an optional `timeoutSeconds`.
 * @returns A pure {@link HttpRequest} describing the submit call.
 */
export function buildSubmitAtHeadRequest(parameters: SubmitAtHeadParameters): HttpRequest {
	const { placeId, script, timeoutSeconds, universeId } = parameters;
	const body =
		timeoutSeconds === undefined ? { script } : { script, timeout: `${timeoutSeconds}s` };
	return {
		body,
		headers: { "content-type": "application/json" },
		method: "POST",
		url: `/cloud/v2/universes/${universeId}/places/${placeId}/luau-execution-session-tasks`,
	};
}
