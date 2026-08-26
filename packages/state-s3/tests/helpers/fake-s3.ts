import type { StateBackendFetch } from "@bedrock-rbx/core";

/**
 * One request the S3 client sent, recorded as it reached the transport.
 */
export interface CapturedS3Request {
	/** Body the client signed and sent, empty when it sent none. */
	readonly body: string;
	/** Headers the client signed the request with. */
	readonly headers: Record<string, string>;
	/** HTTP method the client used. */
	readonly method: string;
	/** Absolute URL the client addressed. */
	readonly url: string;
}

/**
 * An in-memory object store the real S3 client can talk to.
 */
export interface FakeS3 {
	/** Every request the client sent, in order. */
	readonly calls: Array<CapturedS3Request>;
	/** Transport to hand the adapter as its `fetch` seam. */
	readonly fetchFunc: StateBackendFetch;
	/** Stored objects, keyed by the URL path they were written at. */
	readonly objects: Map<string, string>;
}

/**
 * A transport answering every request with one S3 error, so a test can
 * state what the store refused and let the client deserialize it.
 *
 * @param code - S3 error code to answer with.
 * @param status - HTTP status S3 pairs with that code.
 * @returns The transport and the calls it recorded.
 */
export function fakeS3Failure(
	code: string,
	status: number,
): { calls: Array<CapturedS3Request>; fetchFunc: StateBackendFetch } {
	const calls: Array<CapturedS3Request> = [];
	return {
		calls,
		fetchFunc: async (input, init) => {
			calls.push(await captureAsync(input, init));
			return new Response(errorBody(code, `refused with ${code}`), { status });
		},
	};
}

/**
 * Build an in-memory S3 the real client can read from and write to, so a
 * test exercises signing, marshalling and error deserialization instead
 * of a stubbed `send`.
 *
 * @param seed - Objects already in the store, keyed by URL path.
 * @returns The store, the transport, and the calls it records.
 */
export function fakeS3(seed: Readonly<Record<string, string>> = {}): FakeS3 {
	const calls: Array<CapturedS3Request> = [];
	const objects = new Map(Object.entries(seed));

	return {
		calls,
		fetchFunc: async (input, init) => {
			const captured = await captureAsync(input, init);
			calls.push(captured);
			const { pathname } = new URL(captured.url);

			if (captured.method === "PUT") {
				objects.set(pathname, captured.body);
				return new Response("", { headers: { etag: '"fake-etag"' }, status: 200 });
			}

			const stored = objects.get(pathname);
			if (stored === undefined) {
				return new Response(errorBody("NoSuchKey", "The specified key does not exist."), {
					status: 404,
				});
			}

			return new Response(stored, { status: 200 });
		},
		objects,
	};
}

/**
 * Build the XML body S3 answers an error with, which is what the client's
 * own deserializer turns back into a typed exception.
 *
 * @param code - S3 error code, which becomes the exception's name.
 * @param message - Human-readable message S3 pairs with the code.
 * @returns The error document.
 */
function errorBody(code: string, message: string): string {
	return (
		'<?xml version="1.0" encoding="UTF-8"?>' +
		`<Error><Code>${code}</Code><Message>${message}</Message>` +
		"<RequestId>0123456789ABCDEF</RequestId><HostId>fake-host</HostId></Error>"
	);
}

/**
 * Record one request the way the transport received it.
 *
 * @param input - What the handler addressed.
 * @param init - Method, headers and body the handler attached.
 * @returns The captured request.
 */
async function captureAsync(
	input: Request | string | URL,
	init: RequestInit | undefined,
): Promise<CapturedS3Request> {
	const request = new Request(input, init);
	return {
		body: await request.text(),
		headers: Object.fromEntries(request.headers.entries()),
		method: request.method,
		url: request.url,
	};
}
