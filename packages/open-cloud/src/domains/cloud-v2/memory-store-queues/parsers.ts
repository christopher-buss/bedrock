import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isDateTimeString } from "../../../internal/utils/is-date-time-string.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { DequeueResult, QueueItem } from "./types.ts";
import type { MemoryStoreQueueItemWire } from "./wire.ts";

const PATH_PATTERN = /^cloud\/v2\/universes\/(\d+)\/memory-store\/queues\/([^/]+)\/items\/([^/]+)$/;
const MALFORMED_QUEUE_ITEM_MESSAGE = "Malformed memory-store queue item response";
const MALFORMED_DEQUEUE_MESSAGE = "Malformed memory-store dequeue response";

/**
 * Parses a successful memory-store queue-item response body (the
 * `Cloud_CreateMemoryStoreQueueItem` happy path) into the public
 * {@link QueueItem} shape.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the parsed {@link QueueItem}, or an
 *   {@link ApiError} when the body does not match the wire schema.
 */
export function parseQueueItemResponse(response: HttpResponse): Result<QueueItem, ApiError> {
	const item = wireBodyToQueueItem(response.body);
	if (item === undefined) {
		return malformedQueueItem(response.status);
	}

	return { data: item, success: true };
}

/**
 * Parses a successful `Cloud_ReadMemoryStoreQueueItems` response body
 * into the public {@link DequeueResult} shape. Each item in the
 * `queueItems` array is validated through the same path-and-shape
 * checks as {@link parseQueueItemResponse}; a malformed entry rejects
 * the whole response.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the parsed {@link DequeueResult},
 *   or an {@link ApiError} when the response shape is wrong.
 */
export function parseDequeueResponse(response: HttpResponse): Result<DequeueResult, ApiError> {
	const { body, status: statusCode } = response;
	if (!isRecord(body)) {
		return malformedDequeue(statusCode);
	}

	const { id, queueItems } = body;
	if (typeof id !== "string" || !Array.isArray(queueItems)) {
		return malformedDequeue(statusCode);
	}

	const items: Array<QueueItem> = [];
	for (const wire of queueItems) {
		const item = wireBodyToQueueItem(wire);
		if (item === undefined) {
			return malformedDequeue(statusCode);
		}

		items.push(item);
	}

	return { data: { items, readId: id }, success: true };
}

function isQueueItemWire(body: unknown): body is MemoryStoreQueueItemWire {
	if (!isRecord(body)) {
		return false;
	}

	const { data, expireTime, path, priority } = body;
	return (
		typeof path === "string" &&
		isDateTimeString(expireTime) &&
		data !== undefined &&
		data !== null &&
		(priority === undefined || priority === null || typeof priority === "number")
	);
}

function wireBodyToQueueItem(body: unknown): QueueItem | undefined {
	if (!isQueueItemWire(body)) {
		return undefined;
	}

	const match = PATH_PATTERN.exec(body.path);
	const universeId = match?.[1];
	const queueId = match?.[2];
	const id = match?.[3];
	if (universeId === undefined || queueId === undefined || id === undefined) {
		return undefined;
	}

	return {
		id,
		data: body.data,
		expiresAt: new Date(body.expireTime),
		priority: body.priority ?? undefined,
		queueId,
		universeId,
	};
}

function malformedQueueItem(statusCode: number): Result<QueueItem, ApiError> {
	return {
		err: new ApiError(MALFORMED_QUEUE_ITEM_MESSAGE, { statusCode }),
		success: false,
	};
}

function malformedDequeue(statusCode: number): Result<DequeueResult, ApiError> {
	return {
		err: new ApiError(MALFORMED_DEQUEUE_MESSAGE, { statusCode }),
		success: false,
	};
}
