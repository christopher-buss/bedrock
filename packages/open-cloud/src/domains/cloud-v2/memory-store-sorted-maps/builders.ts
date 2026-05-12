import type { HttpRequest } from "../../../client/types.ts";
import type {
	CreateSortedMapItemParameters,
	DeleteSortedMapItemParameters,
	GetSortedMapItemParameters,
	SortKey,
	UpdateSortedMapItemParameters,
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
 * Builds a `DELETE` request for the Open Cloud
 * `Cloud_DeleteMemoryStoreSortedMapItem` endpoint. The `itemId` is
 * URL-encoded into the path segment, matching the `get` and `update`
 * builders.
 *
 * @param parameters - Universe, sorted-map, and item identifiers.
 * @returns A pure {@link HttpRequest} describing the delete call.
 */
export function buildDeleteRequest(parameters: DeleteSortedMapItemParameters): HttpRequest {
	const { itemId, mapId, universeId } = parameters;
	return {
		method: "DELETE",
		url: `/cloud/v2/universes/${universeId}/memory-store/sorted-maps/${mapId}/items/${encodeURIComponent(itemId)}`,
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

/**
 * Builds a `PATCH` request for the Open Cloud
 * `Cloud_UpdateMemoryStoreSortedMapItem` endpoint. Body fields are
 * conditionally included so a partial update sends only the changed
 * fields; the optional `allowMissing` query string drives
 * upsert-on-missing behaviour server-side.
 *
 * @param parameters - Universe, sorted-map, and item identifiers,
 *   plus any subset of `value`, `ttl`, `sortKey`, and `allowMissing`.
 * @returns A pure {@link HttpRequest} describing the update call.
 */
export function buildUpdateRequest(parameters: UpdateSortedMapItemParameters): HttpRequest {
	const { allowMissing: shouldAllowMissing, itemId, mapId, universeId } = parameters;
	const base = `/cloud/v2/universes/${universeId}/memory-store/sorted-maps/${mapId}/items/${encodeURIComponent(itemId)}`;
	const query = new URLSearchParams();
	if (shouldAllowMissing !== undefined) {
		query.append("allowMissing", String(shouldAllowMissing));
	}

	const queryString = query.toString();
	return {
		body: buildUpdateBody(parameters),
		headers: { "content-type": "application/json" },
		method: "PATCH",
		url: queryString === "" ? base : `${base}?${queryString}`,
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

function buildUpdateBody(parameters: UpdateSortedMapItemParameters): Record<string, unknown> {
	const { sortKey, ttl, value } = parameters;
	const body: Record<string, unknown> = {};
	if (value !== undefined) {
		body["value"] = value;
	}

	if (ttl !== undefined) {
		body["ttl"] = `${ttl}s`;
	}

	applySortKeyToBody(body, sortKey);
	return body;
}
