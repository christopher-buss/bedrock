import type { HttpRequest } from "../../../client/types.ts";
import { ValidationError } from "../../../errors/validation.ts";
import type { Result } from "../../../types.ts";
import type { GetParameters, SubmitAtHeadParameters, SubmitAtVersionParameters } from "./types.ts";

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

/**
 * Builds a `GET` request for the Open Cloud "read Luau execution session
 * task" endpoint. The endpoint accepts only the maximal x-aep-resource
 * path shape (universe, place, version, session, task), so the supplied
 * ref must include `versionId` and `sessionId`; refs extracted from the
 * narrower path formats are rejected with a {@link ValidationError}.
 *
 * @param parameters - Task ref and optional view selector. When `view`
 *   is omitted, no `?view=` query is sent and the server applies its
 *   own default (`BASIC`).
 * @returns A success result wrapping the request, or a
 *   {@link ValidationError} when the ref is missing `versionId` or
 *   `sessionId`.
 */
export function buildGetRequest(parameters: GetParameters): Result<HttpRequest, ValidationError> {
	const { ref, view } = parameters;
	const { placeId, sessionId, taskId, universeId, versionId } = ref;

	if (versionId === undefined) {
		return {
			err: new ValidationError("Task ref is missing versionId; cannot GET", {
				code: "incomplete_ref",
			}),
			success: false,
		};
	}

	if (sessionId === undefined) {
		return {
			err: new ValidationError("Task ref is missing sessionId; cannot GET", {
				code: "incomplete_ref",
			}),
			success: false,
		};
	}

	const base = `/cloud/v2/universes/${universeId}/places/${placeId}/versions/${versionId}/luau-execution-sessions/${sessionId}/tasks/${taskId}`;
	const url = view === undefined ? base : `${base}?view=${view}`;
	return { data: { method: "GET", url }, success: true };
}

function buildSubmitBody(parameters: SubmitBodyInput): Record<string, unknown> {
	const { script, timeoutSeconds } = parameters;
	return timeoutSeconds === undefined ? { script } : { script, timeout: `${timeoutSeconds}s` };
}
