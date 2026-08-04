import type { GistFetch } from "#src/adapters/gist-state-adapter";

/** A recording fake `fetch` plus the requests it has seen, in order. */
export interface FakeFetch {
	/** Every request the fake received, in order. */
	readonly calls: Array<Request>;
	/** The fake `fetch` to inject. */
	readonly fetchFn: GistFetch;
}

/** A recording fake sleep plus the delays it was asked for, in order. */
export interface FakeSleep {
	/** Every delay the fake was asked to wait, in order. */
	readonly calls: Array<number>;
	/** The fake sleep to inject; returns without waiting. */
	readonly sleep: (ms: number) => Promise<void>;
}

/**
 * Canned answers keyed by the leg of the gist protocol they belong to, so a
 * test states which call gets which response instead of branching on the
 * request inside the fake.
 */
export interface GistRoutes {
	/** Answers the `GET` of the gist metadata from `api.github.com`. */
	readonly get?: GistReply | ReadonlyArray<GistReply>;
	/** Answers the `PATCH` that writes the gist. */
	readonly patch?: GistReply | ReadonlyArray<GistReply>;
	/** Answers a `raw_url` fetch, which the CDN serves from another host. */
	readonly raw?: GistReply | ReadonlyArray<GistReply>;
}

/**
 * What a route answers with. An `Error` is thrown rather than resolved, which
 * models a transport failure; an array is consumed in order and its final
 * entry repeats once exhausted.
 */
type GistReply = Error | Response;

const GIST_API_HOST = "api.github.com";

/**
 * Build an empty-bodied {@link Response} with the given status.
 *
 * @param status - The HTTP status code to answer with.
 * @returns A `Response` carrying that status and no body.
 */
export function emptyResponse(status: number): Response {
	return new Response("", { status });
}

/**
 * Build a recording fake `fetch` that delegates every call to `responder`.
 *
 * @param responder - Answers each request.
 * @returns The recorded `calls` and the fake `fetch`.
 */
export function fakeFetch(
	responder: (request: Request) => Promise<Response> | Response,
): FakeFetch {
	const calls: Array<Request> = [];
	async function fetchFuncAsync(
		input: globalThis.Request | string | URL,
		init?: RequestInit,
	): Promise<Response> {
		const request = new Request(input, init);
		calls.push(request);
		return responder(request);
	}

	return { calls, fetchFn: fetchFuncAsync };
}

/**
 * Build a recording fake `fetch` that answers each call from `responses` in
 * order, throwing once the queue runs dry.
 *
 * @param responses - The queued responses.
 * @returns The recorded `calls` and the fake `fetch`.
 */
export function fakeFetchSequence(responses: ReadonlyArray<Response>): FakeFetch {
	let index = 0;
	return fakeFetch(() => {
		const response = responses[index];
		if (response === undefined) {
			throw new Error(`fakeFetchSequence: no response queued for call ${String(index + 1)}`);
		}

		index += 1;
		return response;
	});
}

/**
 * Build a recording fake `fetch` that answers each leg of the gist protocol
 * from the supplied route table: the metadata `GET`, the write `PATCH`, and a
 * `raw_url` fetch served from the CDN host.
 *
 * @param routes - Canned answers keyed by protocol leg.
 * @returns The recorded `calls` and the fake `fetch`.
 */
export function fakeGistFetch(routes: GistRoutes): FakeFetch {
	const cursors = new Map<keyof GistRoutes, number>();

	function reply(leg: keyof GistRoutes): Response {
		const route = routes[leg];
		if (route === undefined) {
			throw new Error(`fakeGistFetch: no response routed for '${leg}'`);
		}

		const next =
			route instanceof Error || route instanceof Response ? route : consume(leg, route);
		if (next instanceof Error) {
			throw next;
		}

		return next;
	}

	function consume(leg: keyof GistRoutes, queued: ReadonlyArray<GistReply>): GistReply {
		const index = cursors.get(leg) ?? 0;
		cursors.set(leg, index + 1);
		const next = queued[Math.min(index, queued.length - 1)];
		if (next === undefined) {
			throw new Error(`fakeGistFetch: empty response queue for '${leg}'`);
		}

		return next;
	}

	return fakeFetch((request) => reply(routeOf(request)));
}

/**
 * Build a fake random source that yields `values` in order, repeating the last
 * one once exhausted.
 *
 * @param values - The values to yield.
 * @returns The fake random source.
 */
export function fakeRandom(values: ReadonlyArray<number> = [0]): () => number {
	let index = 0;
	return () => {
		const value = values[index] ?? values.at(-1) ?? 0;
		index += 1;
		return value;
	};
}

/**
 * Build a fake sleep that records the delays it was asked for and returns
 * immediately.
 *
 * @returns The recorded `calls` and the fake sleep.
 */
export function fakeSleep(): FakeSleep {
	const calls: Array<number> = [];
	async function sleepAsync(ms: number): Promise<void> {
		calls.push(ms);
		// Resolve on a later microtask rather than synchronously, so callers
		// that race a poll against a sleep behave as they would in production.
		await Promise.resolve();
	}

	return { calls, sleep: sleepAsync };
}

/**
 * Build a JSON {@link Response} with status 200.
 *
 * @param body - The value to serialize.
 * @returns The response.
 */
export function okJson(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200 });
}

function routeOf(request: Request): keyof GistRoutes {
	if (request.method === "PATCH") {
		return "patch";
	}

	const { hostname } = new URL(request.url);
	return hostname === GIST_API_HOST ? "get" : "raw";
}
