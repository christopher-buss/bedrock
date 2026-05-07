import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { LuauExecutionTask, LuauExecutionTaskRef } from "./types.ts";
import type { LuauExecutionTaskWire } from "./wire.ts";

const MALFORMED_TASK_MESSAGE = "Malformed luau-execution-session-task response";

const PATH_FORMAT_PLAIN_TASK =
	/^universes\/(\d+)\/places\/(\d+)\/luau-execution-session-tasks\/([^/]+)$/;

/**
 * Parses a successful Open Cloud `LuauExecutionSessionTask` response
 * body into the public {@link LuauExecutionTask} discriminated union.
 * Slice 4 handles only in-progress states (`QUEUED`, `PROCESSING`,
 * `CANCELLED`) and the simplest x-aep-resource path format
 * (`universes/{u}/places/{p}/luau-execution-session-tasks/{t}`); later
 * slices widen the supported states and path formats.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud
 *   API.
 * @returns A success result wrapping the parsed task, or an
 *   {@link ApiError} when the body or path do not match a supported
 *   shape.
 */
export function parseLuauExecutionTaskResponse(
	response: HttpResponse,
): Result<LuauExecutionTask, ApiError> {
	const { body, status: statusCode } = response;
	if (!isLuauExecutionTaskWire(body)) {
		return malformed(statusCode);
	}

	const ref = parseTaskRef(body.path);
	if (ref === undefined) {
		return malformed(statusCode);
	}

	return {
		data: {
			createdAt: new Date(body.createTime),
			ref,
			state: body.state,
			updatedAt: new Date(body.updateTime),
			user: body.user,
		},
		success: true,
	};
}

function malformed(statusCode: number): Result<LuauExecutionTask, ApiError> {
	return { err: new ApiError(MALFORMED_TASK_MESSAGE, { statusCode }), success: false };
}

function isInProgressWireState(state: unknown): state is "CANCELLED" | "PROCESSING" | "QUEUED" {
	return state === "QUEUED" || state === "PROCESSING" || state === "CANCELLED";
}

function isLuauExecutionTaskWire(body: unknown): body is LuauExecutionTaskWire {
	return (
		isRecord(body) &&
		typeof body["path"] === "string" &&
		typeof body["createTime"] === "string" &&
		typeof body["updateTime"] === "string" &&
		isInProgressWireState(body["state"]) &&
		typeof body["user"] === "string"
	);
}

function parseTaskRef(path: string): LuauExecutionTaskRef | undefined {
	const match = PATH_FORMAT_PLAIN_TASK.exec(path);
	if (match === null) {
		return undefined;
	}

	const [, universeId, placeId, taskId] = match;
	if (universeId === undefined || placeId === undefined || taskId === undefined) {
		return undefined;
	}

	return {
		placeId,
		sessionId: undefined,
		taskId,
		universeId,
		versionId: undefined,
	};
}
