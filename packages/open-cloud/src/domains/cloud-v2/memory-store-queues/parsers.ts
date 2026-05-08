import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { QueueItem } from "./types.ts";
import type { MemoryStoreQueueItemWire } from "./wire.ts";

const PATH_PATTERN = /^cloud\/v2\/universes\/(\d+)\/memory-store\/queues\/([^/]+)\/items\/([^/]+)$/;
const MALFORMED_QUEUE_ITEM_MESSAGE = "Malformed memory-store queue item response";

/**
 * Parses a successful memory-store queue-item response body into the
 * public {@link QueueItem} shape. Used by both the enqueue and dequeue
 * paths; the dequeue parser splits the array first and parses each
 * entry through this function.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the parsed {@link QueueItem}, or an
 *   {@link ApiError} when the body does not match the wire schema.
 */
export function parseQueueItemResponse(response: HttpResponse): Result<QueueItem, ApiError> {
	const { body, status: statusCode } = response;

	if (!isQueueItemWire(body)) {
		return malformed(statusCode);
	}

	const match = PATH_PATTERN.exec(body.path);
	const universeId = match?.[1];
	const queueId = match?.[2];
	const id = match?.[3];
	if (universeId === undefined || queueId === undefined || id === undefined) {
		return malformed(statusCode);
	}

	return {
		data: {
			id,
			data: body.data,
			expiresAt: new Date(body.expireTime),
			priority: body.priority ?? undefined,
			queueId,
			universeId,
		},
		success: true,
	};
}

function malformed(statusCode: number): Result<QueueItem, ApiError> {
	return {
		err: new ApiError(MALFORMED_QUEUE_ITEM_MESSAGE, { statusCode }),
		success: false,
	};
}

function isQueueItemWire(body: unknown): body is MemoryStoreQueueItemWire {
	if (!isRecord(body)) {
		return false;
	}

	const { data, expireTime, path, priority } = body;
	return (
		typeof path === "string" &&
		typeof expireTime === "string" &&
		data !== undefined &&
		data !== null &&
		(priority === undefined || priority === null || typeof priority === "number")
	);
}
