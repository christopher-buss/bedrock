import type { OpenCloudError } from "#src/errors/base";
import type { HttpRequest, HttpResponse } from "#src/internal/http/types";
import type { Result } from "#src/types";

/**
 * The `send` callback shape consumed by `executeWithRetry`. A plain
 * transport function — no `RequestConfig`, no queueing, no retries.
 */
export type SendFunc = (request: HttpRequest) => Promise<Result<HttpResponse, OpenCloudError>>;

/**
 * A scripted fake for the `send` callback. Replays responses in order
 * and records every request it receives.
 */
export interface FakeSend {
	/** Chronological log of every request the fake received. */
	readonly requests: ReadonlyArray<HttpRequest>;
	/** The scripted send callback. */
	readonly send: SendFunc;
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
export function createFakeSend(options: {
	readonly responses: ReadonlyArray<Result<HttpResponse, OpenCloudError>>;
}): FakeSend {
	const requests: Array<HttpRequest> = [];
	let index = 0;

	async function send(request: HttpRequest): Promise<Result<HttpResponse, OpenCloudError>> {
		requests.push(request);
		const response = options.responses[index];
		index += 1;

		if (response === undefined) {
			throw new Error(
				`createFakeSend exhausted: ${String(index)} calls made, only ${String(options.responses.length)} responses scripted`,
			);
		}

		return response;
	}

	return { requests, send };
}
