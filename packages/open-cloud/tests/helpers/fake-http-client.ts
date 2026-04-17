import type { OpenCloudError } from "#src/errors/base";
import type { HttpRequest, HttpResponse } from "#src/internal/http/types";
import type { Result } from "#src/types";

/** A transport callback shaped like the `send` argument of `executeWithRetry`. */
export type FakeSend = (request: HttpRequest) => Promise<Result<HttpResponse, OpenCloudError>>;

/**
 * A scripted HTTP send: replays `responses` in order and records every
 * request it receives.
 */
export interface FakeHttpClient {
	/** Chronological log of every request the fake received. */
	readonly requests: ReadonlyArray<HttpRequest>;
	/** The scripted send callback. */
	readonly send: FakeSend;
}

/**
 * Creates a scripted fake for the `send` callback. Each call returns the
 * next queued response; exhausting the queue throws, which surfaces test
 * setup mistakes instead of silently repeating the last response.
 *
 * @param options - The scripted responses to replay, in order.
 * @returns A `send` callback plus a `requests` log.
 * @rejects {Error} When a call is made after all scripted responses are consumed.
 */
export function createFakeHttpClient(options: {
	readonly responses: ReadonlyArray<Result<HttpResponse, OpenCloudError>>;
}): FakeHttpClient {
	const requests: Array<HttpRequest> = [];
	let index = 0;

	async function send(request: HttpRequest): Promise<Result<HttpResponse, OpenCloudError>> {
		requests.push(request);
		const response = options.responses[index];
		index += 1;

		if (response === undefined) {
			throw new Error(
				`createFakeHttpClient exhausted: ${String(index)} calls made, only ${String(options.responses.length)} responses scripted`,
			);
		}

		return response;
	}

	return { requests, send };
}
