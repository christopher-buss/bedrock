import type { HttpRequest } from "../../../client/types.ts";
import type {
	DequeueQueueItemsParameters,
	DiscardQueueItemsParameters,
	EnqueueQueueItemParameters,
} from "./types.ts";

/**
 * Builds a `POST` request for the Open Cloud
 * `Cloud_CreateMemoryStoreQueueItem` endpoint. Serializes the optional
 * `ttl` field as a Google protobuf `Duration` string in seconds (`"30s"`)
 * to match the wire contract.
 *
 * @param parameters - Universe and queue identifiers, the opaque payload,
 *   and optional priority and TTL.
 * @returns A pure {@link HttpRequest} describing the enqueue call.
 */
export function buildEnqueueRequest(parameters: EnqueueQueueItemParameters): HttpRequest {
	const { data, priority, queueId, ttl, universeId } = parameters;
	const body: Record<string, unknown> = { data };
	if (priority !== undefined) {
		body["priority"] = priority;
	}

	if (ttl !== undefined) {
		body["ttl"] = `${ttl}s`;
	}

	return {
		body,
		headers: { "content-type": "application/json" },
		method: "POST",
		url: `/cloud/v2/universes/${universeId}/memory-store/queues/${queueId}/items`,
	};
}

/**
 * Builds a `GET` request for the Open Cloud
 * `Cloud_ReadMemoryStoreQueueItems` endpoint. The `:read` suffix is a
 * custom-method marker; the call is HTTP `GET` despite the AIP-136
 * convention that custom methods use `POST`. Parameters travel as query
 * string only; there is no request body.
 *
 * `invisibilityWindow` is serialized as a Google protobuf `Duration`
 * string in seconds (`"30s"`), matching the wire contract.
 *
 * @param parameters - Universe and queue identifiers, plus optional
 *   `count`, `allOrNothing`, and `invisibilityWindow`.
 * @returns A pure {@link HttpRequest} describing the dequeue call.
 */
export function buildDequeueRequest(parameters: DequeueQueueItemsParameters): HttpRequest {
	const query = new URLSearchParams();
	if (parameters.count !== undefined) {
		query.append("count", String(parameters.count));
	}

	if (parameters.allOrNothing !== undefined) {
		query.append("allOrNothing", String(parameters.allOrNothing));
	}

	if (parameters.invisibilityWindow !== undefined) {
		query.append("invisibilityWindow", `${parameters.invisibilityWindow}s`);
	}

	const queryString = query.toString();
	const { queueId, universeId } = parameters;
	const base = `/cloud/v2/universes/${universeId}/memory-store/queues/${queueId}/items:read`;
	return {
		method: "GET",
		url: queryString === "" ? base : `${base}?${queryString}`,
	};
}

/**
 * Builds a `POST` request for the Open Cloud
 * `Cloud_DiscardMemoryStoreQueueItems` endpoint. The request body uses
 * `{ readId }`, matching the schema (the dequeue *response* uses `id`,
 * but the discard *request* matches the schema and is not patched).
 *
 * @param parameters - Universe and queue identifiers, plus the
 *   `readId` returned from a prior dequeue.
 * @returns A pure {@link HttpRequest} describing the discard call.
 */
export function buildDiscardRequest(parameters: DiscardQueueItemsParameters): HttpRequest {
	const { queueId, readId, universeId } = parameters;
	return {
		body: { readId },
		headers: { "content-type": "application/json" },
		method: "POST",
		url: `/cloud/v2/universes/${universeId}/memory-store/queues/${queueId}/items:discard`,
	};
}
