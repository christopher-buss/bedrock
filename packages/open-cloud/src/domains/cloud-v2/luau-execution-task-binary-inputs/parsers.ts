import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
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
 *   {@link ApiError} when the body does not match the expected shape.
 */
export function parseBinaryInputResponse(
	response: HttpResponse,
): Result<LuauExecutionTaskBinaryInput, ApiError> {
	const { body, status: statusCode } = response;

	if (!isRecord(body)) {
		return malformed(statusCode);
	}

	if (typeof body["path"] !== "string" || !PATH_PATTERN.test(body["path"])) {
		return malformed(statusCode);
	}

	if (typeof body["uploadUri"] !== "string") {
		return malformed(statusCode);
	}

	return {
		data: { path: body["path"], uploadUri: body["uploadUri"] },
		success: true,
	};
}

function malformed(statusCode: number): Result<LuauExecutionTaskBinaryInput, ApiError> {
	return { err: new ApiError(MALFORMED_MESSAGE, { statusCode }), success: false };
}
