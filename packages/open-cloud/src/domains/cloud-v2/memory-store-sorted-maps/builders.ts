import type { HttpRequest } from "../../../client/types.ts";
import type {
	CreateSortedMapItemParameters,
	GetSortedMapItemParameters,
	SortKey,
} from "./types.ts";

/**
 * Builds a `POST` request for the Open Cloud
 * `Cloud_CreateMemoryStoreSortedMapItem` endpoint. The caller-supplied
 * `itemId` travels as the `id` query parameter (URL-encoded by
 * `URLSearchParams`); the body carries `value`, the optional `ttl`
 * (serialized as a Google protobuf `Duration` string in seconds), and
 * one of `stringSortKey`/`numericSortKey` projected from the
 * {@link SortKey} discriminated union.
 *
 * @param parameters - Universe, sorted-map, item identifiers, the
 *   value to store, and optional `sortKey` and `ttl`.
 * @returns A pure {@link HttpRequest} describing the create call.
 */
export function buildCreateRequest(parameters: CreateSortedMapItemParameters): HttpRequest {
	const { itemId, mapId, sortKey, ttl, universeId, value } = parameters;
	const body: Record<string, unknown> = { value };
	if (ttl !== undefined) {
		body["ttl"] = `${ttl}s`;
	}

	applySortKeyToBody(body, sortKey);

	const query = new URLSearchParams({ id: itemId });
	return {
		body,
		headers: { "content-type": "application/json" },
		method: "POST",
		url: `/cloud/v2/universes/${universeId}/memory-store/sorted-maps/${mapId}/items?${query.toString()}`,
	};
}

/**
 * Builds a `GET` request for the Open Cloud
 * `Cloud_GetMemoryStoreSortedMapItem` endpoint. The `itemId` is
 * URL-encoded into the path segment so callers can pass values
 * containing reserved characters without manual escaping.
 *
 * @param parameters - Universe, sorted-map, and item identifiers.
 * @returns A pure {@link HttpRequest} describing the get call.
 */
export function buildGetRequest(parameters: GetSortedMapItemParameters): HttpRequest {
	const { itemId, mapId, universeId } = parameters;
	return {
		method: "GET",
		url: `/cloud/v2/universes/${universeId}/memory-store/sorted-maps/${mapId}/items/${encodeURIComponent(itemId)}`,
	};
}

function applySortKeyToBody(body: Record<string, unknown>, sortKey: SortKey | undefined): void {
	if (sortKey === undefined) {
		return;
	}

	if (sortKey.kind === "string") {
		body["stringSortKey"] = sortKey.value;
		return;
	}

	body["numericSortKey"] = sortKey.value;
}
