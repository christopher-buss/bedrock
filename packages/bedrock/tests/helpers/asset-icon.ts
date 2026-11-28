import { asSha256Hex } from "@bedrock-rbx/core";
import type { createFakeHttpClient } from "@bedrock-rbx/ocale/testing";

import { createHash } from "node:crypto";
import { assert } from "vitest";

/** Fake HTTP client the Open Cloud clients of an icon test send through. */
export type FakeHttpClient = ReturnType<typeof createFakeHttpClient>;

/**
 * Driver for registries whose tests never create or retire that Kind: each
 * call throws, so an unexpected write fails the test loudly.
 */
export const UNUSED_DRIVER = {
	create: () => {
		throw new Error("Unexpected create");
	},
	retire: () => {
		throw new Error("Unexpected retire");
	},
};

/**
 * Body of an Assets API operation, done once it carries a response.
 *
 * @param id - Value of `operationId`, also the last segment of `path`.
 * @param response - What the done operation produced; omit while pending.
 * @returns The operation body.
 */
export function operation(id: string, response?: unknown): unknown {
	return {
		done: response !== undefined,
		operationId: id,
		path: `operations/${id}`,
		...(response === undefined ? {} : { response }),
	};
}

/**
 * Queue an image upload: the pending create, then its done poll.
 *
 * @param assets - Fake client of the assets client.
 * @param image - ID and moderation state of the new image.
 * @param image.assetId - ID of the new image.
 * @param image.moderationState - Moderation state of the new image.
 * @returns The same client, for chaining.
 */
export function mockImageUpload(
	assets: FakeHttpClient,
	{ assetId = "789", moderationState = "Approved" } = {},
): FakeHttpClient {
	return assets.mockResponse({ body: operation("op-create"), status: 200 }).mockResponse({
		body: operation("op-create", {
			assetId,
			moderationResult: { moderationState },
			path: `assets/${assetId}`,
		}),
		status: 200,
	});
}

/**
 * Queue an icon update on a place: the pending update, then its done poll.
 *
 * @param assets - Fake client of the assets client.
 * @param placeId - Place whose icon is set.
 * @returns The same client, for chaining.
 */
export function mockIconUpdate(assets: FakeHttpClient, placeId = "4711"): FakeHttpClient {
	return assets.mockResponse({ body: operation("op-update"), status: 200 }).mockResponse({
		body: operation("op-update", { assetId: placeId, path: `assets/${placeId}` }),
		status: 200,
	});
}

/**
 * SHA-256 of icon bytes, as the state records it.
 *
 * @param bytes - Icon file bytes.
 * @returns The branded hex digest.
 */
export function sha256Of(bytes: Uint8Array): ReturnType<typeof asSha256Hex> {
	return asSha256Hex(createHash("sha256").update(bytes).digest("hex"));
}

/**
 * Each request the client sent, as `METHOD url`.
 *
 * @param httpClient - The fake client.
 * @returns One line per request, in order.
 */
export function requestLines(httpClient: FakeHttpClient): ReadonlyArray<string> {
	return httpClient.requests.map(({ request }) => `${request.method} ${request.url}`);
}

/**
 * The JSON `request` part of a multipart request the client sent.
 *
 * @param httpClient - The fake client.
 * @param index - Position of the request.
 * @returns The parsed `request` part.
 */
export async function formRequestPartAsync(
	httpClient: FakeHttpClient,
	index: number,
): Promise<JSONValue> {
	const sent = httpClient.requests[index];
	assert(sent !== undefined, `no request at ${index}`);
	const { body } = sent.request;
	assert(body instanceof FormData, "request body should be multipart");
	const part = body.get("request");
	assert(part !== null, "multipart body should have a request part");
	return JSON.parse(typeof part === "string" ? part : await part.text());
}
