import { describe, expect, it, onTestFinished, vi } from "vitest";

import { ApiError } from "../errors/api-error.ts";
import { RequestDeadlineExceededError } from "../errors/request-deadline-exceeded.ts";
import type { Result } from "../types.ts";
import { createFetchHttpClient } from "./http/fetch-client.ts";
import { CREATE_METHOD_DEFAULTS } from "./http/retry.ts";
import { okRequest, ResourceClient, type ResourceMethodSpec } from "./resource-client.ts";

const WINDOW_CAPACITY = 3;
const WINDOW_MS = 1000;
const BURST_SIZE = 40;
/** Median round trip the probe measured; responses report a stale budget. */
const LATENCY_MS = 850;

/**
 * Documents a limit far above the server's real one, so the opening burst
 * reaches the server at once the way a network stall delivers it, and only
 * the server's rate-limit headers can bring the client back under its limit.
 */
const BURST_SPEC: ResourceMethodSpec<undefined, true> = {
	buildRequest: () => okRequest({ body: {}, method: "POST", url: "/burst" }),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: Object.freeze({ maxPerSecond: BURST_SIZE, operationKey: "test.burst" }),
	parse: (response) => {
		return response.status === 200
			? { data: true, success: true }
			: {
					err: new ApiError("unexpected status", { statusCode: response.status }),
					success: false,
				};
	},
};

interface ReceivedRequest {
	readonly admitted: boolean;
	readonly at: number;
}

async function timerSleepAsync(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * A server granting {@link WINDOW_CAPACITY} requests per clock-aligned window
 * and answering the excess with a guided 429, headers as Roblox sends them.
 * Each request counts when it arrives; its response lands {@link LATENCY_MS}
 * later.
 *
 * @returns The server's fetch and the log of every request it received.
 */
function createWindowedServer(): {
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	readonly received: ReadonlyArray<ReceivedRequest>;
} {
	const received: Array<ReceivedRequest> = [];

	async function fetchAsync(): Promise<Response> {
		const at = Date.now();
		const windowStart = Math.floor(at / WINDOW_MS) * WINDOW_MS;
		const admittedInWindow = received.filter((request) => {
			return request.admitted && request.at >= windowStart;
		}).length;
		const admitted = admittedInWindow < WINDOW_CAPACITY;
		received.push({ admitted, at });
		await timerSleepAsync(LATENCY_MS);
		const headers = {
			"x-ratelimit-limit": "3, 3;w=1, 3;w=1",
			"x-ratelimit-remaining": String(admitted ? WINDOW_CAPACITY - admittedInWindow - 1 : 0),
			"x-ratelimit-reset": "1",
		};
		return admitted
			? new Response("{}", { headers, status: 200 })
			: new Response('{"errors":[{"code":0,"message":""}]}', {
					headers: { ...headers, "retry-after": "5", "x-envoy-ratelimited": "true" },
					status: 429,
				});
	}

	return { fetch: fetchAsync, received };
}

function useFakeTime(): void {
	vi.useFakeTimers({ now: 0 });
	onTestFinished(() => {
		vi.useRealTimers();
	});
}

async function burstAsync(
	client: ResourceClient,
	deadlineMs?: number,
): Promise<ReadonlyArray<Result<true, unknown>>> {
	const pending = Promise.all(
		Array.from({ length: BURST_SIZE }, async () => {
			return client.executeAsync({
				options: deadlineMs === undefined ? undefined : { deadlineMs },
				parameters: undefined,
				spec: BURST_SPEC,
			});
		}),
	);
	await vi.runAllTimersAsync();
	return pending;
}

function failuresOf(results: ReadonlyArray<Result<true, unknown>>): ReadonlyArray<unknown> {
	return results.flatMap((result) => (result.success ? [] : [result.err]));
}

function maxReceivedPerWindow(requests: ReadonlyArray<ReceivedRequest>): number {
	const counts = Map.groupBy(requests, ({ at }) => Math.floor(at / WINDOW_MS));
	return Math.max(...Array.from(counts.values(), (window) => window.length));
}

describe("resourceClient rate-limit recovery", () => {
	it("should finish a burst far beyond the window capacity once the server grants room", async () => {
		expect.assertions(3);

		useFakeTime();
		const server = createWindowedServer();
		const client = new ResourceClient({
			apiKey: "test-key",
			httpClient: createFetchHttpClient(server.fetch),
			sleep: timerSleepAsync,
		});

		const results = await burstAsync(client);

		const openingBurst = server.received.filter(({ at }) => at < WINDOW_MS);
		const afterOpeningBurst = server.received.filter(({ at }) => at >= WINDOW_MS);

		expect(results.filter(({ success }) => success)).toHaveLength(BURST_SIZE);
		expect(openingBurst).toHaveLength(BURST_SIZE);
		expect(maxReceivedPerWindow(afterOpeningBurst)).toBeLessThanOrEqual(WINDOW_CAPACITY);
	});

	it("should fail only the requests the deadline leaves no room for", async () => {
		expect.assertions(3);

		useFakeTime();
		const server = createWindowedServer();
		const client = new ResourceClient({
			apiKey: "test-key",
			httpClient: createFetchHttpClient(server.fetch),
			sleep: timerSleepAsync,
		});

		const results = await burstAsync(client, 10_000);

		const succeeded = results.filter(({ success }) => success).length;
		const failures = failuresOf(results);

		expect(succeeded).toBeGreaterThan(WINDOW_CAPACITY);
		expect(failures.length).toBeGreaterThan(0);
		expect(failures.every((error) => error instanceof RequestDeadlineExceededError)).toBeTrue();
	});
});
