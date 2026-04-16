import { describe, expect, it, vi } from "vitest";

import { sleep } from "./sleep";

describe(sleep, () => {
	it("should resolve after the specified delay", async () => {
		expect.assertions(1);

		vi.useFakeTimers();

		const promise = sleep(100);
		vi.advanceTimersByTime(100);

		await expect(promise).resolves.toBeUndefined();

		vi.useRealTimers();
	});
});
