import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { LogMessage, LogPage } from "./types.ts";
import type { LogChunkWire, LogMessageWire } from "./wire.ts";

const MALFORMED_LOGS_MESSAGE = "Malformed list-luau-execution-task-logs response";

/**
 * Parses a successful Open Cloud list-luau-execution-task-logs response
 * body into the public {@link LogPage} shape. Chunks are flattened into
 * a single ordered array of {@link LogMessage} values. The
 * `MESSAGE_TYPE_UNSPECIFIED` sentinel is rejected.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the parsed {@link LogPage}, or an
 *   {@link ApiError} when the body does not match a supported shape.
 */
export function parseListLogsResponse(response: HttpResponse): Result<LogPage, ApiError> {
	const { body, status: statusCode } = response;
	if (!isRecord(body)) {
		return malformed(statusCode);
	}

	const rawChunks = body["luauExecutionSessionTaskLogs"] ?? undefined;
	if (!isOptionalLogChunks(rawChunks)) {
		return malformed(statusCode);
	}

	const rawToken = body["nextPageToken"] ?? undefined;
	if (rawToken !== undefined && typeof rawToken !== "string") {
		return malformed(statusCode);
	}

	const messages: Array<LogMessage> = [];
	for (const chunk of rawChunks ?? []) {
		for (const wireMessage of chunk.structuredMessages ?? []) {
			messages.push({
				createTime: wireMessage.createTime,
				message: wireMessage.message,
				messageType: wireMessage.messageType,
			});
		}
	}

	return {
		data: { messages, nextPageToken: rawToken },
		success: true,
	};
}

function isAcceptedMessageType(value: unknown): value is LogMessageWire["messageType"] {
	return value === "OUTPUT" || value === "INFO" || value === "WARNING" || value === "ERROR";
}

function isLogMessageWire(value: unknown): value is LogMessageWire {
	return (
		isRecord(value) &&
		typeof value["createTime"] === "string" &&
		typeof value["message"] === "string" &&
		isAcceptedMessageType(value["messageType"])
	);
}

function isOptionalStructuredMessages(
	value: unknown,
): value is ReadonlyArray<LogMessageWire> | undefined {
	return (
		value === undefined ||
		(Array.isArray(value) && value.every((item: unknown) => isLogMessageWire(item)))
	);
}

function isLogChunkWire(value: unknown): value is LogChunkWire {
	return isRecord(value) && isOptionalStructuredMessages(value["structuredMessages"]);
}

function isOptionalLogChunks(value: unknown): value is ReadonlyArray<LogChunkWire> | undefined {
	return (
		value === undefined ||
		(Array.isArray(value) && value.every((item: unknown) => isLogChunkWire(item)))
	);
}

function malformed(statusCode: number): Result<LogPage, ApiError> {
	return { err: new ApiError(MALFORMED_LOGS_MESSAGE, { statusCode }), success: false };
}
