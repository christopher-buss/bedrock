import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isDateTimeString } from "../../../internal/utils/is-date-time-string.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { ListSortedMapItemsResult, SortedMapItem, SortKey } from "./types.ts";
import type { MemoryStoreSortedMapItemWire } from "./wire.ts";

const PATH_PATTERN =
	/^cloud\/v2\/universes\/(\d+)\/memory-store\/sorted-maps\/([^/]+)\/items\/([^/]+)$/;
const MALFORMED_MESSAGE = "Malformed memory-store sorted-map item response";
const MALFORMED_LIST_MESSAGE = "Malformed memory-store sorted-map list response";

/**
 * Parses a successful memory-store sorted-map item response body (the
 * happy path for create, get, and update) into the public
 * {@link SortedMapItem} shape.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the parsed {@link SortedMapItem},
 *   or an {@link ApiError} when the body does not match the wire schema.
 */
export function parseSortedMapItemResponse(
	response: HttpResponse,
): Result<SortedMapItem, ApiError> {
	const item = wireBodyToSortedMapItem(response.body);
	if (item === undefined) {
		return malformedSortedMapItem(response.status);
	}

	return { data: item, success: true };
}

/**
 * Parses a successful `Cloud_ListMemoryStoreSortedMapItems` response
 * body into the public {@link ListSortedMapItemsResult} shape. Each
 * item in the `memoryStoreSortedMapItems` array is validated through
 * the same path-and-shape checks as
 * {@link parseSortedMapItemResponse}; a malformed entry rejects the
 * whole response.
 *
 * @param response - The full {@link HttpResponse} from the Open Cloud API.
 * @returns A success result wrapping the parsed
 *   {@link ListSortedMapItemsResult}, or an {@link ApiError} when the
 *   response shape is wrong.
 */
export function parseListResponse(
	response: HttpResponse,
): Result<ListSortedMapItemsResult, ApiError> {
	const { body, status: statusCode } = response;
	if (!isRecord(body)) {
		return malformedList(statusCode);
	}

	const { memoryStoreSortedMapItems, nextPageToken } = body;
	if (!Array.isArray(memoryStoreSortedMapItems)) {
		return malformedList(statusCode);
	}

	if (nextPageToken !== undefined && typeof nextPageToken !== "string") {
		return malformedList(statusCode);
	}

	const items = memoryStoreSortedMapItems.map(wireBodyToSortedMapItem);
	if (!items.every(isSortedMapItem)) {
		return malformedList(statusCode);
	}

	return { data: { items, nextPageToken }, success: true };
}

function isSortedMapItemWire(body: unknown): body is MemoryStoreSortedMapItemWire {
	if (!isRecord(body)) {
		return false;
	}

	const { id, etag, expireTime, numericSortKey, path, stringSortKey, value } = body;
	return (
		typeof path === "string" &&
		typeof etag === "string" &&
		typeof id === "string" &&
		isDateTimeString(expireTime) &&
		value !== undefined &&
		(stringSortKey === undefined ||
			stringSortKey === null ||
			typeof stringSortKey === "string") &&
		(numericSortKey === undefined ||
			numericSortKey === null ||
			typeof numericSortKey === "number")
	);
}

function extractSortKey(body: MemoryStoreSortedMapItemWire): "conflict" | SortKey | undefined {
	const hasStringKey = typeof body.stringSortKey === "string";
	const hasNumericKey = typeof body.numericSortKey === "number";
	if (hasStringKey && hasNumericKey) {
		return "conflict";
	}

	if (hasStringKey) {
		return { kind: "string", value: body.stringSortKey };
	}

	if (hasNumericKey) {
		return { kind: "numeric", value: body.numericSortKey };
	}

	return undefined;
}

function wireBodyToSortedMapItem(body: unknown): SortedMapItem | undefined {
	if (!isSortedMapItemWire(body)) {
		return undefined;
	}

	const match = PATH_PATTERN.exec(body.path);
	const universeId = match?.[1];
	const mapId = match?.[2];
	const id = match?.[3];
	if (universeId === undefined || mapId === undefined || id === undefined) {
		return undefined;
	}

	const sortKey = extractSortKey(body);
	if (sortKey === "conflict") {
		return undefined;
	}

	return {
		id,
		etag: body.etag,
		expiresAt: new Date(body.expireTime),
		mapId,
		sortKey,
		universeId,
		value: body.value,
	};
}

function malformedSortedMapItem(statusCode: number): Result<SortedMapItem, ApiError> {
	return {
		err: new ApiError(MALFORMED_MESSAGE, { statusCode }),
		success: false,
	};
}

function isSortedMapItem(item: SortedMapItem | undefined): item is SortedMapItem {
	return item !== undefined;
}

function malformedList(statusCode: number): Result<ListSortedMapItemsResult, ApiError> {
	return {
		err: new ApiError(MALFORMED_LIST_MESSAGE, { statusCode }),
		success: false,
	};
}
