import type { StateBackendFetch } from "@bedrock-rbx/core";

import { onTestFinished, vi } from "vitest";

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
	/**
	 * Store one object the way another writer would, minting the fresh
	 * entity tag that makes every condition read before it stale.
	 */
	readonly put: (pathname: string, body: string) => void;
}

/** What the fake store holds, and the counter its entity tags come from. */
interface StoredObjects {
	/** Entity tag each stored object answers with, keyed by URL path. */
	readonly etags: Map<string, string>;
	/** Stored objects, keyed by URL path. */
	readonly objects: Map<string, string>;
	/** How many writes have landed, which is what makes each tag distinct. */
	written: number;
}

/** What a transport is handed as the thing to address. */
type Addressed = Request | string | URL;

/**
 * Put one transport in front of the runtime's own `fetch` for a test, and
 * take it back off once the test finishes. It is how a **Backend** that
 * core injects no transport into - the migrate source, which is handed
 * coordinates and an environment only - is driven against a fake store.
 *
 * @param transport - Transport the client's requests should reach.
 */
export function stubGlobalFetch(transport: StateBackendFetch): void {
	vi.stubGlobal("fetch", transport);
	onTestFinished(() => {
		vi.unstubAllGlobals();
	});
}

/**
 * Build the XML body S3 answers an error with, which is what the client's
 * own deserializer turns back into a typed exception.
 *
 * @param code - S3 error code, which becomes the exception's name.
 * @param message - Human-readable message S3 pairs with the code.
 * @returns The error document.
 */
export function errorBody(code: string, message: string): string {
	return (
		'<?xml version="1.0" encoding="UTF-8"?>' +
		`<Error><Code>${code}</Code><Message>${message}</Message>` +
		"<RequestId>0123456789ABCDEF</RequestId><HostId>fake-host</HostId></Error>"
	);
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

// The segment naming a probe's scratch object, which is what tells one
// apart from the lock object a test is exercising.
const PROBE_SEGMENT = "/.probe-";

/**
 * Read the object path one request addressed.
 *
 * @param input - What the client addressed.
 * @returns The URL path, prefix and key included.
 */
export function pathOf(input: Addressed): string {
	const addressed = new URL(input instanceof Request ? input.url : input);
	return addressed.pathname;
}

/**
 * Whether one request addresses a probe's scratch object rather than a
 * lock object.
 *
 * @param input - What the client addressed.
 * @returns `true` when the request is the probe's.
 */
export function isProbeRequest(input: Addressed): boolean {
	return pathOf(input).includes(PROBE_SEGMENT);
}

/**
 * Wrap a transport so a probe's scratch object is answered by a store that
 * honours conditional creates, leaving the transport under test to answer
 * only for the lock object itself.
 *
 * A test stating how a store answers one acquisition is not stating how it
 * answers the probe that runs first, and a transport that answered both on
 * the same terms would be.
 *
 * @param inner - Transport answering everything that is not the probe's.
 * @returns The transport to hand the lock port.
 */
export function honouringProbe(inner: StateBackendFetch): StateBackendFetch {
	let written = false;

	return async (input, init) => {
		if (!isProbeRequest(input)) {
			return inner(input, init);
		}

		if (init?.method === "DELETE") {
			written = false;
			return new Response("", { status: 204 });
		}

		if (written) {
			return new Response(errorBody("PreconditionFailed", "the pre-condition did not hold"), {
				status: 412,
			});
		}

		written = true;
		return new Response("", { headers: { etag: '"probe"' }, status: 200 });
	};
}

/**
 * A transport answering every write with success, which is how a store
 * that never evaluates a condition answers.
 *
 * @returns The transport and the calls it recorded.
 */
export function fakeS3TakingEveryWrite(): {
	calls: Array<CapturedS3Request>;
	fetchFunc: StateBackendFetch;
} {
	const calls: Array<CapturedS3Request> = [];
	return {
		calls,
		fetchFunc: async (input, init) => {
			calls.push(await captureAsync(input, init));
			return new Response("", { headers: { etag: '"taken"' }, status: 200 });
		},
	};
}

/**
 * Build an in-memory S3 the real client can read from and write to, so a
 * test exercises signing, marshalling and error deserialization instead
 * of a stubbed `send`.
 *
 * Conditional writes are honoured the way S3 honours them: `If-None-Match`
 * requires the object to be absent and `If-Match` requires it to still
 * answer with the given entity tag, and either refused answers `412
 * PreconditionFailed`. Each stored object carries its own entity tag,
 * which changes on every write.
 *
 * @param seed - Objects already in the store, keyed by URL path.
 * @returns The store, the transport, and the calls it records.
 */
export function fakeS3(seed: Readonly<Record<string, string>> = {}): FakeS3 {
	const calls: Array<CapturedS3Request> = [];
	const objects = new Map(Object.entries(seed));
	const etags = new Map(Array.from(objects.keys(), (path, index) => [path, `"seed-${index}"`]));
	const store: StoredObjects = { etags, objects, written: 0 };

	return {
		calls,
		fetchFunc: async (input, init) => {
			const captured = await captureAsync(input, init);
			calls.push(captured);
			return answer(store, captured);
		},
		objects,
		put: (pathname, body) => {
			store.written += 1;
			objects.set(pathname, body);
			etags.set(pathname, `"written-${store.written}"`);
		},
	};
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

/**
 * Build the answer S3 gives a request for a key the store holds nothing at.
 *
 * @returns The `404` response, carrying the code the client deserializes.
 */
function noSuchKey(): Response {
	return new Response(errorBody("NoSuchKey", "The specified key does not exist."), {
		status: 404,
	});
}

/**
 * Read the entity tag one stored object answers with, minting one for an
 * object a test put into the store by hand.
 *
 * @param store - What the fake store holds.
 * @param pathname - URL path the object is stored at.
 * @returns The entity tag.
 */
function etagOf(store: StoredObjects, pathname: string): string {
	const known = store.etags.get(pathname);
	if (known !== undefined) {
		return known;
	}

	store.written += 1;
	const minted = `"written-${store.written}"`;
	store.etags.set(pathname, minted);
	return minted;
}

/**
 * Decide whether a conditional write may land, on the terms S3 states
 * them: a wildcard `If-None-Match` requires the object to be absent, and
 * `If-Match` requires the stored entity tag to be the one named.
 *
 * @param headers - Headers the client signed the request with.
 * @param etag - Entity tag the stored object answers with, absent when the
 * store holds nothing at that path.
 * @returns `true` when the write may land.
 */
function conditionHolds(
	headers: Readonly<Record<string, string>>,
	etag: string | undefined,
): boolean {
	const ifNoneMatch = headers["if-none-match"];
	if (ifNoneMatch !== undefined) {
		return ifNoneMatch === "*" && etag === undefined;
	}

	const ifMatch = headers["if-match"];
	return ifMatch === undefined || ifMatch === etag;
}

/**
 * Store one object, unless the condition the write carried rules it out.
 *
 * @param store - What the fake store holds.
 * @param request - The write as it reached the transport.
 * @returns The response to hand back to the client.
 */
function write(store: StoredObjects, request: CapturedS3Request): Response {
	const { pathname } = new URL(request.url);
	const held = store.objects.has(pathname);
	if (!held && request.headers["if-match"] !== undefined) {
		return noSuchKey();
	}

	if (!conditionHolds(request.headers, held ? etagOf(store, pathname) : undefined)) {
		return new Response(
			errorBody(
				"PreconditionFailed",
				"At least one of the pre-conditions you specified did not hold",
			),
			{ status: 412 },
		);
	}

	store.written += 1;
	const etag = `"written-${store.written}"`;
	store.objects.set(pathname, request.body);
	store.etags.set(pathname, etag);
	return new Response("", { headers: { etag }, status: 200 });
}

/**
 * Answer one request the way S3 answers it.
 *
 * @param store - What the fake store holds.
 * @param request - The request as it reached the transport.
 * @returns The response to hand back to the client.
 */
function answer(store: StoredObjects, request: CapturedS3Request): Response {
	if (request.method === "PUT") {
		return write(store, request);
	}

	const { pathname } = new URL(request.url);
	if (request.method === "DELETE") {
		store.objects.delete(pathname);
		store.etags.delete(pathname);
		return new Response("", { status: 204 });
	}

	const stored = store.objects.get(pathname);
	if (stored === undefined) {
		return noSuchKey();
	}

	return new Response(stored, { headers: { etag: etagOf(store, pathname) }, status: 200 });
}
