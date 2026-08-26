import { HttpRequest } from "@smithy/core/protocols";

import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { assert, describe, expect, it } from "vitest";

import { createFetchRequestHandler } from "./fetch-request-handler.ts";

interface Captured {
	readonly body: string;
	readonly headers: Record<string, string>;
	readonly method: string;
	readonly url: string;
}

const GET_STATE = {
	headers: {},
	hostname: "my-bucket.s3.eu-west-2.amazonaws.com",
	method: "GET",
	path: "/production.json",
	protocol: "https:",
};

const SIGNATURE = "AWS4-HMAC-SHA256 Credential=example/20260826/eu-west-2/s3/aws4_request";

/**
 * Record what the handler asks the transport for, answering every call
 * with one canned response.
 *
 * @param answer - Response the transport replies with.
 * @returns The captured calls and the transport that records them.
 */
function capturingFetch(answer: () => Response): {
	calls: Array<Captured>;
	fetchFunc: (input: Request | string | URL, init?: RequestInit) => Promise<Response>;
} {
	const calls: Array<Captured> = [];
	return {
		calls,
		fetchFunc: async (input, init) => {
			const request = new Request(input, init);
			calls.push({
				body: await request.text(),
				headers: Object.fromEntries(request.headers.entries()),
				method: request.method,
				url: request.url,
			});
			return answer();
		},
	};
}

/**
 * Answer every request with an empty success, so a test asserting on the
 * request it sent says nothing about the response.
 *
 * @returns An empty `200`.
 */
function emptyOk(): Response {
	return new Response("", { status: 200 });
}

describe(createFetchRequestHandler, () => {
	it("should address the endpoint the client described", async () => {
		expect.assertions(1);

		const { calls, fetchFunc } = capturingFetch(emptyOk);

		await createFetchRequestHandler(fetchFunc).handle(
			new HttpRequest({ ...GET_STATE, query: { "x-id": "GetObject" } }),
		);

		expect(calls[0]!.url).toBe(
			"https://my-bucket.s3.eu-west-2.amazonaws.com/production.json?x-id=GetObject",
		);
	});

	it("should address a port the client named, as an s3-compatible endpoint has", async () => {
		expect.assertions(1);

		const { calls, fetchFunc } = capturingFetch(emptyOk);

		await createFetchRequestHandler(fetchFunc).handle(
			new HttpRequest({
				headers: {},
				hostname: "localhost",
				method: "GET",
				path: "/my-bucket/production.json",
				port: 9000,
				protocol: "http:",
			}),
		);

		expect(calls[0]!.url).toBe("http://localhost:9000/my-bucket/production.json");
	});

	it("should carry the signed headers and the string body onto the request", async () => {
		expect.assertions(3);

		const { calls, fetchFunc } = capturingFetch(emptyOk);

		await createFetchRequestHandler(fetchFunc).handle(
			new HttpRequest({
				...GET_STATE,
				body: '{"version":1}',
				headers: { authorization: SIGNATURE },
				method: "PUT",
			}),
		);

		expect(calls[0]!.method).toBe("PUT");
		expect(calls[0]!.headers["authorization"]).toBe(SIGNATURE);
		expect(calls[0]!.body).toBe('{"version":1}');
	});

	it("should carry a binary body onto the request unchanged", async () => {
		expect.assertions(1);

		const { calls, fetchFunc } = capturingFetch(emptyOk);
		const encoder = new TextEncoder();

		await createFetchRequestHandler(fetchFunc).handle(
			new HttpRequest({
				...GET_STATE,
				body: encoder.encode("binary-payload"),
				method: "PUT",
			}),
		);

		expect(calls[0]!.body).toBe("binary-payload");
	});

	it("should send no body for a request whose body the transport cannot carry", async () => {
		expect.assertions(1);

		const { calls, fetchFunc } = capturingFetch(emptyOk);

		await createFetchRequestHandler(fetchFunc).handle(
			new HttpRequest({ ...GET_STATE, body: { notABody: true } }),
		);

		expect(calls[0]!.body).toBe("");
	});

	it("should advertise no transport configuration of its own", () => {
		expect.assertions(1);

		const { fetchFunc } = capturingFetch(emptyOk);
		const handler = createFetchRequestHandler(fetchFunc);

		handler.updateHttpClientConfig("requestTimeout", 1000);

		expect(handler.httpHandlerConfigs()).toStrictEqual({});
	});

	it("should hand the client back the status, headers and body the transport answered with", async () => {
		expect.assertions(3);

		const { fetchFunc } = capturingFetch(() => {
			return new Response('{"stored":true}', {
				headers: { etag: '"deadbeef"' },
				status: 200,
			});
		});

		const { response } = await createFetchRequestHandler(fetchFunc).handle(
			new HttpRequest(GET_STATE),
		);

		assert(response.body instanceof Readable);

		expect(response.statusCode).toBe(200);
		expect(response.headers["etag"]).toBe('"deadbeef"');
		await expect(text(response.body)).resolves.toBe('{"stored":true}');
	});
});
