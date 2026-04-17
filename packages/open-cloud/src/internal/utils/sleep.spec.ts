import { describe, expect, it, vi } from "vitest";

import { sleep } from "./sleep.ts";

describe(sleep, () => {
	it("should not resolve before the specified delay elapses", async () => {
		expect.assertions(2);

		vi.useFakeTimers();

		const settled = vi.fn<() => void>();
		const promise = sleep(100).then(settled);

		vi.advanceTimersByTime(99);
		await Promise.resolve();

		expect(settled).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		await promise;

		expect(settled).toHaveBeenCalledOnce();

		vi.useRealTimers();
	});
});
