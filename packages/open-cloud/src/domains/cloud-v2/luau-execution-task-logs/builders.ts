import type { HttpRequest } from "../../../client/types.ts";
import { ValidationError } from "../../../errors/validation.ts";
import type { Result } from "../../../types.ts";
import type { ListLogsParameters } from "./types.ts";

/**
 * Builds a `GET` request for the Open Cloud "list Luau execution session
 * task logs" endpoint. The endpoint requires the maximal x-aep-resource
 * path shape (universe, place, version, session, task), so the supplied
 * ref must include `versionId` and `sessionId`; refs extracted from the
 * narrower path formats are rejected with a {@link ValidationError}.
 *
 * The `view` query parameter is hard-coded to `STRUCTURED` so callers
 * always receive typed structured messages. No public `view` parameter
 * is exposed.
 *
 * @param parameters - Task ref, and optional `pageSize` and `pageToken`
 *   pagination controls.
 * @returns A success result wrapping the request, or a
 *   {@link ValidationError} when the ref is missing `versionId` or
 *   `sessionId`.
 */
export function buildListLogsRequest(
	parameters: ListLogsParameters,
): Result<HttpRequest, ValidationError> {
	const { pageSize, pageToken, ref } = parameters;
	const { placeId, sessionId, taskId, universeId, versionId } = ref;

	if (versionId === undefined) {
		return {
			err: new ValidationError("Task ref is missing versionId; cannot list logs", {
				code: "incomplete_ref",
			}),
			success: false,
		};
	}

	if (sessionId === undefined) {
		return {
			err: new ValidationError("Task ref is missing sessionId; cannot list logs", {
				code: "incomplete_ref",
			}),
			success: false,
		};
	}

	const base = `/cloud/v2/universes/${universeId}/places/${placeId}/versions/${versionId}/luau-execution-sessions/${sessionId}/tasks/${taskId}/logs`;
	const url = `${base}?${buildQuery(pageSize, pageToken).toString()}`;
	return { data: { method: "GET", url }, success: true };
}

function buildQuery(pageSize: number | undefined, pageToken: string | undefined): URLSearchParams {
	const query = new URLSearchParams({ view: "STRUCTURED" });

	if (pageSize !== undefined) {
		query.append("maxPageSize", String(pageSize));
	}

	if (pageToken !== undefined) {
		query.append("pageToken", pageToken);
	}

	return query;
}
