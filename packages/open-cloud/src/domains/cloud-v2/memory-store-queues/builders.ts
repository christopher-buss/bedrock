import type { HttpRequest } from "../../../client/types.ts";
import type { EnqueueQueueItemParameters } from "./types.ts";

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
