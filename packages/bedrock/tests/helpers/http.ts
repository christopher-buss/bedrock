import type { HttpRequest } from "@bedrock-rbx/ocale";

import { assert } from "vitest";

/**
 * Narrows a recorded request body to the JSON object a resource driver sent.
 * `HttpRequest.body` also admits `FormData` and `Uint8Array` for the upload
 * transports, so tests that assert on JSON fields have to rule those out
 * before indexing.
 *
 * @param request - A request recorded by the fake HTTP client.
 * @returns The body as a plain record.
 */
export function jsonRequestBody({ body }: HttpRequest): Record<string, unknown> {
	assert(isRecord(body), "request body should be a JSON object");
	return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}
