import type { HttpResponse } from "../../../client/types.ts";
import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import { toJsonDetails } from "../../../internal/utils/to-json-details.ts";
import type { Result } from "../../../types.ts";
import type { LogMessage, LogPage } from "./types.ts";
import type { LogChunkWire, LogMessageWire } from "./wire.ts";

const MALFORMED_LOGS_MESSAGE = "Malformed list-luau-execution-task-logs response";

/**
 * Parses a successful Open Cloud list-luau-execution-task-logs response
 * body into the public {@link LogPage} shape. Chunks are flattened into
 * a single ordered array of {@link LogMessage} values.
 *
 * The SDK requests STRUCTURED view, so both the chunk list and each
 * chunk's message array must be present. Explicit empty arrays are valid;
 * missing arrays reject the page rather than silently losing log output.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the parsed {@link LogPage}, or an
 *   {@link UnexpectedResponseError} when the body does not match a supported
 *   shape.
 */
export function parseListLogsResponse({
	body,
	status: statusCode,
}: HttpResponse): Result<LogPage, UnexpectedResponseError> {
	if (!isRecord(body)) {
		return malformed(statusCode, body);
	}

	const rawChunks = body["luauExecutionSessionTaskLogs"];
	if (!isLogChunks(rawChunks)) {
		return malformed(statusCode, body);
	}

	const rawToken = body["nextPageToken"];
	if (rawToken !== undefined && typeof rawToken !== "string") {
		return malformed(statusCode, body);
	}

	const messages: Array<LogMessage> = [];
	for (const chunk of rawChunks) {
		for (const wireMessage of chunk.structuredMessages) {
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
	return (
		value === "MESSAGE_TYPE_UNSPECIFIED" ||
		value === "OUTPUT" ||
		value === "INFO" ||
		value === "WARNING" ||
		value === "ERROR"
	);
}

function isLogMessageWire(value: unknown): value is LogMessageWire {
	return (
		isRecord(value) &&
		typeof value["createTime"] === "string" &&
		typeof value["message"] === "string" &&
		isAcceptedMessageType(value["messageType"])
	);
}

/**
 * Requires an explicit message array: captured no-print tasks return `[]`.
 * Missing or null messages do not establish that a chunk has no output.
 *
 * @param value - The chunk's untrusted `structuredMessages` field.
 * @returns Whether the field is an array containing only valid messages.
 */
function isStructuredMessages(value: unknown): value is ReadonlyArray<LogMessageWire> {
	return Array.isArray(value) && value.every((item: unknown) => isLogMessageWire(item));
}

/**
 * Validates a chunk for the STRUCTURED view always requested by the SDK.
 * The schema also describes FLAT chunks that omit `structuredMessages`;
 * accepting those here would silently discard their output.
 *
 * @param value - An untrusted entry in the response's chunk list.
 * @returns Whether the chunk contains a valid structured message array.
 */
function isLogChunkWire(value: unknown): value is LogChunkWire {
	return isRecord(value) && isStructuredMessages(value["structuredMessages"]);
}

/**
 * Requires an explicit chunk list, including `[]` for an empty page.
 * Validates every chunk before flattening so one malformed chunk rejects
 * the whole page instead of returning a partial log list.
 *
 * @param value - The untrusted `luauExecutionSessionTaskLogs` field.
 * @returns Whether the field is an array containing only valid chunks.
 */
function isLogChunks(value: unknown): value is ReadonlyArray<LogChunkWire> {
	return Array.isArray(value) && value.every((item: unknown) => isLogChunkWire(item));
}

function malformed(statusCode: number, body: unknown): Result<LogPage, UnexpectedResponseError> {
	return {
		err: new UnexpectedResponseError(MALFORMED_LOGS_MESSAGE, {
			details: toJsonDetails(body),
			statusCode,
		}),
		success: false,
	};
}
