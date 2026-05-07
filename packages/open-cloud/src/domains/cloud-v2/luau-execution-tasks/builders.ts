import type { HttpRequest } from "../../../client/types.ts";
import type { SubmitAtHeadParameters, SubmitAtVersionParameters } from "./types.ts";

interface SubmitBodyInput {
	readonly script: string;
	readonly timeoutSeconds?: number;
}

const JSON_HEADERS: Readonly<Record<string, string>> = { "content-type": "application/json" };

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
	const { placeId, universeId } = parameters;
	return {
		body: buildSubmitBody(parameters),
		headers: JSON_HEADERS,
		method: "POST",
		url: `/cloud/v2/universes/${universeId}/places/${placeId}/luau-execution-session-tasks`,
	};
}

/**
 * Builds a `POST` request for the Open Cloud "create Luau execution
 * session task" endpoint, targeting a specific place version. Differs
 * from {@link buildSubmitAtHeadRequest} only in URL shape: the path
 * includes the `versions/{versionId}` segment so the script runs
 * against that exact place version instead of the live head.
 *
 * @param parameters - Universe, place, and version identifiers, the
 *   script body, and an optional `timeoutSeconds`.
 * @returns A pure {@link HttpRequest} describing the submit call.
 */
export function buildSubmitAtVersionRequest(parameters: SubmitAtVersionParameters): HttpRequest {
	const { placeId, universeId, versionId } = parameters;
	return {
		body: buildSubmitBody(parameters),
		headers: JSON_HEADERS,
		method: "POST",
		url: `/cloud/v2/universes/${universeId}/places/${placeId}/versions/${versionId}/luau-execution-session-tasks`,
	};
}

function buildSubmitBody(parameters: SubmitBodyInput): Record<string, unknown> {
	const { script, timeoutSeconds } = parameters;
	return timeoutSeconds === undefined ? { script } : { script, timeout: `${timeoutSeconds}s` };
}
