import { assert, describe, it, vi } from "vitest";

import { createFakeHttpClient } from "../../../tests/helpers/fake-http-client.ts";
import { createFakeSleep } from "../../../tests/helpers/fake-sleep.ts";
import { RequestDeadlineExceededError } from "../../errors/request-deadline-exceeded.ts";
import { ResourceClient } from "../../internal/resource-client.ts";
import { submitAndPollAsync } from "./polling-helpers.ts";

describe(submitAndPollAsync, () => {
	it("should return the submit failure unchanged when the caller aborts during a budget-bound submit", async ({
		expect,
	}) => {
		expect.assertions(1);

		const controller = new AbortController();
		let failure: RequestDeadlineExceededError | undefined;
		const inner = new ResourceClient({
			credential: { apiKey: "test-key", kind: "apiKey" },
			httpClient: createFakeHttpClient(),
			sleep: createFakeSleep(),
		});
		vi.spyOn(inner, "executeAsync").mockImplementation(async ({ options }) => {
			controller.abort("cancelled");
			failure = new RequestDeadlineExceededError("Request deadline elapsed", {
				deadlineMs: Number(options!.deadlineMs),
				remainingMs: 0,
			});
			return { err: failure, success: false };
		});

		const result = await submitAndPollAsync(inner, {
			options: { signal: controller.signal, timeoutMs: 500 },
			parameters: { placeId: "456", script: "return 1", universeId: "123" },
		});

		assert(!result.success);

		expect(result.err).toBe(failure);
	});
});
