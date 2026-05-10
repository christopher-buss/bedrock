import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { LuauExecutionTask, LuauExecutionTaskRef } from "./types.ts";
import type {
	LuauExecutionTaskErrorWire,
	LuauExecutionTaskOutputWire,
	LuauExecutionTaskWire,
} from "./wire.ts";

const MALFORMED_TASK_MESSAGE = "Malformed luau-execution-session-task response";

// Matches any of the four x-aep-resource path formats for a luau
// execution session task.
//
// Capture groups:
// 1. universeId
// 2. placeId
// 3. versionId (when `/versions/{v}/` segment is present, else undefined)
// 4. sessionId (when `/luau-execution-sessions/{s}/tasks/...` branch matched)
// 5. taskId (when `/luau-execution-sessions/.../tasks/{t}` branch matched)
// 6. taskId (when `/luau-execution-session-tasks/{t}` branch matched)
const PATH_PATTERN =
	/^universes\/(\d+)\/places\/(\d+)(?:\/versions\/(\d+))?(?:\/luau-execution-sessions\/([^/]+)\/tasks\/([^/]+)|\/luau-execution-session-tasks\/([^/]+))$/;

type InProgressWireState = Exclude<LuauExecutionTaskWire["state"], "COMPLETE" | "FAILED">;

interface ParseVariantArgs {
	readonly body: LuauExecutionTaskWire;
	readonly ref: LuauExecutionTaskRef;
	readonly statusCode: number;
	readonly timeoutSeconds: number | undefined;
}

/**
 * Parses a successful Open Cloud `LuauExecutionSessionTask` response
 * body into the public {@link LuauExecutionTask} discriminated union.
 * Handles every supported task state (in-progress, COMPLETE, FAILED)
 * across all four x-aep-resource path shapes the server returns.
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

	const timeoutSeconds = parseTimeoutSeconds(body.timeout);

	if (body.state === "COMPLETE") {
		return parseCompleteTask({ body, ref, statusCode, timeoutSeconds });
	}

	if (body.state === "FAILED") {
		return parseFailedTask({ body, ref, statusCode, timeoutSeconds });
	}

	return parseInProgressTask({ body, ref, state: body.state, statusCode, timeoutSeconds });
}

function isAcceptedWireState(
	state: unknown,
): state is "CANCELLED" | "COMPLETE" | "FAILED" | "PROCESSING" | "QUEUED" {
	return (
		state === "QUEUED" ||
		state === "PROCESSING" ||
		state === "CANCELLED" ||
		state === "COMPLETE" ||
		state === "FAILED"
	);
}

function isErrorWireCode(code: unknown): code is LuauExecutionTaskErrorWire["code"] {
	return (
		code === "SCRIPT_ERROR" ||
		code === "DEADLINE_EXCEEDED" ||
		code === "OUTPUT_SIZE_LIMIT_EXCEEDED" ||
		code === "INTERNAL_ERROR"
	);
}

function isErrorWire(value: unknown): value is LuauExecutionTaskErrorWire {
	return (
		isRecord(value) && isErrorWireCode(value["code"]) && typeof value["message"] === "string"
	);
}

function isOptionalErrorWire(value: unknown): value is LuauExecutionTaskErrorWire | undefined {
	return value === undefined || isErrorWire(value);
}

function isOutputWire(value: unknown): value is LuauExecutionTaskOutputWire {
	return isRecord(value) && Array.isArray(value["results"]);
}

function isOptionalOutputWire(value: unknown): value is LuauExecutionTaskOutputWire | undefined {
	return value === undefined || isOutputWire(value);
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
	return value === undefined || typeof value === "boolean";
}

function isLuauExecutionTaskWire(body: unknown): body is LuauExecutionTaskWire {
	return (
		isRecord(body) &&
		typeof body["path"] === "string" &&
		typeof body["createTime"] === "string" &&
		typeof body["updateTime"] === "string" &&
		isAcceptedWireState(body["state"]) &&
		typeof body["user"] === "string" &&
		isOptionalOutputWire(body["output"]) &&
		isOptionalErrorWire(body["error"]) &&
		isOptionalDurationWire(body["timeout"]) &&
		isOptionalString(body["binaryInput"]) &&
		isOptionalBoolean(body["enableBinaryOutput"]) &&
		isOptionalString(body["binaryOutputUri"])
	);
}

const DURATION_PATTERN = /^(\d+)s$/;

function isOptionalDurationWire(value: unknown): value is string | undefined {
	return value === undefined || (typeof value === "string" && DURATION_PATTERN.test(value));
}

function parseTimeoutSeconds(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	const match = DURATION_PATTERN.exec(value);
	const seconds = match?.[1];
	if (seconds === undefined) {
		return undefined;
	}

	return Number.parseInt(seconds, 10);
}

function malformed(statusCode: number): Result<LuauExecutionTask, ApiError> {
	return { err: new ApiError(MALFORMED_TASK_MESSAGE, { statusCode }), success: false };
}

function parseInProgressTask(
	args: ParseVariantArgs & { readonly state: InProgressWireState },
): Result<LuauExecutionTask, ApiError> {
	const { body, ref, state, timeoutSeconds } = args;
	return {
		data: {
			binaryInput: body.binaryInput,
			binaryOutputUri: body.binaryOutputUri,
			createdAt: new Date(body.createTime),
			enableBinaryOutput: body.enableBinaryOutput,
			ref,
			state,
			timeoutSeconds,
			updatedAt: new Date(body.updateTime),
			user: body.user,
		},
		success: true,
	};
}

function parseCompleteTask(args: ParseVariantArgs): Result<LuauExecutionTask, ApiError> {
	const { body, ref, statusCode, timeoutSeconds } = args;
	if (body.output === undefined) {
		return malformed(statusCode);
	}

	return {
		data: {
			binaryInput: body.binaryInput,
			binaryOutputUri: body.binaryOutputUri,
			createdAt: new Date(body.createTime),
			enableBinaryOutput: body.enableBinaryOutput,
			output: { results: body.output.results },
			ref,
			state: "COMPLETE",
			timeoutSeconds,
			updatedAt: new Date(body.updateTime),
			user: body.user,
		},
		success: true,
	};
}

function parseFailedTask(args: ParseVariantArgs): Result<LuauExecutionTask, ApiError> {
	const { body, ref, statusCode, timeoutSeconds } = args;
	if (body.error === undefined) {
		return malformed(statusCode);
	}

	return {
		data: {
			binaryInput: body.binaryInput,
			binaryOutputUri: body.binaryOutputUri,
			createdAt: new Date(body.createTime),
			enableBinaryOutput: body.enableBinaryOutput,
			error: { code: body.error.code, message: body.error.message },
			ref,
			state: "FAILED",
			timeoutSeconds,
			updatedAt: new Date(body.updateTime),
			user: body.user,
		},
		success: true,
	};
}

function parseTaskRef(path: string): LuauExecutionTaskRef | undefined {
	const match = PATH_PATTERN.exec(path);
	if (match === null) {
		return undefined;
	}

	const [, universeId, placeId, versionId, sessionId, sessionTaskId, plainTaskId] = match;
	const taskId = sessionTaskId ?? plainTaskId;
	if (universeId === undefined || placeId === undefined || taskId === undefined) {
		return undefined;
	}

	return { placeId, sessionId, taskId, universeId, versionId };
}
