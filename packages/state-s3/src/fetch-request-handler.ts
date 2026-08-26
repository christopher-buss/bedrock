import type { StateBackendFetch } from "@bedrock-rbx/core";
import type { HttpHandler, HttpResponse } from "@smithy/core/protocols";
import { buildQueryString } from "@smithy/querystring-builder";

import { Readable } from "node:stream";

/**
 * Route the S3 client's requests through an injected `fetch` rather than
 * through a socket the client opens itself.
 *
 * The client stays real: it signs, marshals, and deserializes exactly as
 * it does against AWS, and only the transport underneath it changes. That
 * is what lets this **Backend**'s tests exercise signing and error
 * deserialization instead of asserting against a stubbed `send`.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { HttpRequest } from "@smithy/core/protocols";
 *
 * import { createFetchRequestHandler } from "@bedrock-rbx/state-s3";
 *
 * const handler = createFetchRequestHandler(async () => new Response("", { status: 200 }));
 *
 * return handler
 *     .handle(
 *         new HttpRequest({
 *             headers: {},
 *             hostname: "my-bucket.s3.eu-west-2.amazonaws.com",
 *             method: "GET",
 *             path: "/production.json",
 *             protocol: "https:",
 *         }),
 *     )
 *     .then(({ response }) => {
 *         expect(response.statusCode).toBe(200);
 *     });
 * ```
 *
 * @param fetchFunc - Transport the client's requests are sent through.
 * @returns A request handler the S3 client accepts as its transport.
 */
export function createFetchRequestHandler(
	fetchFunc: StateBackendFetch,
): HttpHandler<Record<string, unknown>> {
	return {
		async handle(request) {
			const init: RequestInit = { headers: request.headers, method: request.method };
			const body = requestBody(request.body);
			const response = await fetchFunc(
				requestUrl(request),
				body === undefined ? init : { ...init, body },
			);

			const received: HttpResponse = {
				body: Readable.from([new Uint8Array(await response.arrayBuffer())]),
				headers: Object.fromEntries(response.headers.entries()),
				reason: response.statusText,
				statusCode: response.status,
			};

			return { response: received };
		},
		httpHandlerConfigs() {
			return {};
		},
		updateHttpClientConfig() {
			// Nothing to hold: connection settings belong to the injected
			// transport, not to the handler wrapping it.
		},
	};
}

/**
 * Narrow the body the client produced to what `fetch` can send. Every
 * request this **Backend** makes carries a serialized state file or
 * nothing, so a body of any other shape is one the client never builds
 * here.
 *
 * @param body - Body the client attached to the request.
 * @returns The body to send, or `undefined` when there is none to send.
 */
function requestBody(body: unknown): string | Uint8Array<ArrayBuffer> | undefined {
	if (typeof body === "string") {
		return body;
	}

	if (body instanceof Uint8Array) {
		// Copied into a plain `ArrayBuffer` view: a state file is small, and
		// the copy is what keeps the body a shape `fetch` accepts whatever
		// buffer the client allocated it over.
		return new Uint8Array(body);
	}

	return undefined;
}

/**
 * Address the request the way the client described it, rebuilding the
 * query from the same parameter bag the signature was computed over so
 * the URL sent matches the one signed.
 *
 * @param request - The signed request the client handed the transport.
 * @returns The absolute URL to send the request to.
 */
function requestUrl(request: {
	hostname: string;
	path: string;
	port?: number | undefined;
	protocol: string;
	query: Record<string, Array<string> | null | string>;
}): string {
	const port = request.port === undefined ? "" : `:${request.port}`;
	const query = buildQueryString(request.query);
	const search = query === "" ? "" : `?${query}`;
	return `${request.protocol}//${request.hostname}${port}${request.path}${search}`;
}
