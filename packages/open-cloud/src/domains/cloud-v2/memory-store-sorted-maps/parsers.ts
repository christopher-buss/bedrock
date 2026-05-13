import type { HttpResponse } from "../../../client/types.ts";
import { ApiError } from "../../../errors/api-error.ts";
import { isDateTimeString } from "../../../internal/utils/is-date-time-string.ts";
import { isRecord } from "../../../internal/utils/is-record.ts";
import type { Result } from "../../../types.ts";
import type { ListSortedMapItemsResult, SortedMapItem, SortKey } from "./types.ts";
import type { MemoryStoreSortedMapItemWire } from "./wire.ts";

// The CREATE and LIST endpoints emit paths under singular `memory-store`,
// while GET emits plural `memory-stores`. The regex tolerates both to
// absorb that upstream inconsistency at the wire boundary.
const PATH_PATTERN =
	/^cloud\/v2\/universes\/(\d+)\/memory-stores?\/sorted-maps\/([^/]+)\/items\/([^/]+)$/;
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
 * item in the `items` array is validated through the same
 * path-and-shape checks as {@link parseSortedMapItemResponse}; a
 * malformed entry rejects the whole response.
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

	const { items: rawItemsField, nextPageToken } = body;
	if (rawItemsField !== undefined && rawItemsField !== null && !Array.isArray(rawItemsField)) {
		return malformedList(statusCode);
	}

	const normalizedToken = nextPageToken ?? undefined;
	if (normalizedToken !== undefined && typeof normalizedToken !== "string") {
		return malformedList(statusCode);
	}

	const rawItems = rawItemsField ?? [];
	const items = rawItems.map(wireBodyToSortedMapItem);
	if (!items.every(isSortedMapItem)) {
		return malformedList(statusCode);
	}

	return { data: { items, nextPageToken: normalizedToken }, success: true };
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

	// Validate path shape and extract the universe + map ids from it,
	// but read the item id from `body.id` directly: item ids may contain
	// characters that arrive URL-encoded inside `path` (e.g. `::` shows
	// up as `%3A%3A`), and the body's top-level `id` field carries the
	// decoded form the caller supplied.
	const match = PATH_PATTERN.exec(body.path);
	if (match === null) {
		return undefined;
	}

	const [, universeId, mapId] = match;
	if (universeId === undefined || mapId === undefined) {
		return undefined;
	}

	const sortKey = extractSortKey(body);
	if (sortKey === "conflict") {
		return undefined;
	}

	return {
		id: body.id,
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
