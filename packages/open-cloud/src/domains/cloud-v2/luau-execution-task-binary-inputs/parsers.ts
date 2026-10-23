import type { HttpResponse } from "../../../client/types.ts";
import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Result } from "../../../types.ts";
import type { LuauExecutionTaskBinaryInput } from "./types.ts";

const PATH_PATTERN = /^universes\/(\d+)\/luau-execution-session-task-binary-inputs\/([^/]+)$/;

const MALFORMED_MESSAGE = "Malformed luau-execution-session-task-binary-input response";

/**
 * Parses a successful Open Cloud
 * `Cloud_CreateLuauExecutionSessionTaskBinaryInput` response body into
 * the public {@link LuauExecutionTaskBinaryInput}.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the parsed binary input, or an
 *   {@link UnexpectedResponseError} when the body does not match the expected
 *   shape.
 */
export function parseBinaryInputResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<LuauExecutionTaskBinaryInput, UnexpectedResponseError> {
	if (!isRecord(body)) {
		return malformed(statusCode, body);
	}

	if (typeof body["path"] !== "string" || !PATH_PATTERN.test(body["path"])) {
		return malformed(statusCode, body);
	}

	if (typeof body["uploadUri"] !== "string") {
		return malformed(statusCode, body);
	}

	return {
		data: { path: body["path"], uploadUri: body["uploadUri"] },
		success: true,
	};
}

function malformed(
	statusCode: number,
	body: unknown,
): Result<LuauExecutionTaskBinaryInput, UnexpectedResponseError> {
	return {
		err: new UnexpectedResponseError(MALFORMED_MESSAGE, {
			details: toJsonDetails(body),
			statusCode,
		}),
		success: false,
	};
}
