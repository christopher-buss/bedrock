import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { LuauExecutionTask, LuauExecutionTaskRef } from "./types.ts";
import type { LuauExecutionTaskOutputWire, LuauExecutionTaskWire } from "./wire.ts";

const MALFORMED_TASK_MESSAGE = "Malformed luau-execution-session-task response";

const PATH_FORMAT_PLAIN_TASK =
	/^universes\/(\d+)\/places\/(\d+)\/luau-execution-session-tasks\/([^/]+)$/;

interface ParseCompleteTaskArgs {
	readonly body: LuauExecutionTaskWire;
	readonly ref: LuauExecutionTaskRef;
	readonly statusCode: number;
}

/**
 * Parses a successful Open Cloud `LuauExecutionSessionTask` response
 * body into the public {@link LuauExecutionTask} discriminated union.
 * Slice 5 handles in-progress states (`QUEUED`, `PROCESSING`,
 * `CANCELLED`) and the `COMPLETE` state (with typed `output.results`),
 * over the simplest x-aep-resource path format
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

	if (body.state === "COMPLETE") {
		return parseCompleteTask({ body, ref, statusCode });
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

function parseCompleteTask(args: ParseCompleteTaskArgs): Result<LuauExecutionTask, ApiError> {
	const { body, ref, statusCode } = args;
	if (body.output === undefined) {
		return malformed(statusCode);
	}

	return {
		data: {
			createdAt: new Date(body.createTime),
			output: { results: body.output.results },
			ref,
			state: "COMPLETE",
			updatedAt: new Date(body.updateTime),
			user: body.user,
		},
		success: true,
	};
}

function isAcceptedWireState(
	state: unknown,
): state is "CANCELLED" | "COMPLETE" | "PROCESSING" | "QUEUED" {
	return (
		state === "QUEUED" ||
		state === "PROCESSING" ||
		state === "CANCELLED" ||
		state === "COMPLETE"
	);
}

function isOutputWire(value: unknown): value is LuauExecutionTaskOutputWire {
	return isRecord(value) && Array.isArray(value["results"]);
}

function isOptionalOutputWire(value: unknown): value is LuauExecutionTaskOutputWire | undefined {
	return value === undefined || isOutputWire(value);
}

function isLuauExecutionTaskWire(body: unknown): body is LuauExecutionTaskWire {
	return (
		isRecord(body) &&
		typeof body["path"] === "string" &&
		typeof body["createTime"] === "string" &&
		typeof body["updateTime"] === "string" &&
		isAcceptedWireState(body["state"]) &&
		typeof body["user"] === "string" &&
		isOptionalOutputWire(body["output"])
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
