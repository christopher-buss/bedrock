import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { makeRetryConfig } from "#tests/helpers/retry-config";
import { assert, describe, expect, it, vi } from "vitest";

import { executeWithRetry } from "./execute.ts";
import type { HttpRequest, HttpResponse, OpenCloudHooks } from "./types.ts";

function okResponse(body: unknown = {}): HttpResponse {
	return { body, headers: {}, status: 200 };
}

const request: HttpRequest = { method: "GET", url: "/v1/ping" };

describe(executeWithRetry, () => {
	it("should return the first response when the initial attempt succeeds", async () => {
		expect.assertions(4);

		const onRequest = vi.fn<(request: HttpRequest) => void>();
		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const onRateLimit = vi.fn<(waitMs: number) => void>();
		const hooks: OpenCloudHooks = { onRateLimit, onRequest, onRetry };
		const fakeHttp = createFakeHttpClient({
			responses: [{ data: okResponse({ id: "1" }), success: true }],
		});
		const fakeSleep = createFakeSleep();

		const result = await executeWithRetry(request, {
			config: makeRetryConfig(),
			hooks,
			send: fakeHttp.send,
			sleep: fakeSleep.sleep,
		});

		assert(result.success);

		expect(result.data.body).toStrictEqual({ id: "1" });
		expect(fakeHttp.requests).toHaveLength(1);
		expect(onRetry).not.toHaveBeenCalled();
		expect(onRateLimit).not.toHaveBeenCalled();
	});
});
