import { describe, expect, it, vi } from "vitest";

import { ABORTED, raceWithAbortAsync } from "./abort.ts";

describe(raceWithAbortAsync, () => {
	it("should skip the operation when the signal is already aborted", async () => {
		expect.assertions(2);

		const operation = vi.fn<() => Promise<string>>(async () => "late");

		await expect(raceWithAbortAsync(operation, AbortSignal.abort())).resolves.toBe(ABORTED);
		expect(operation).not.toHaveBeenCalled();
	});

	it("should return the operation result when no signal is supplied", async () => {
		expect.assertions(1);

		await expect(raceWithAbortAsync(async () => "done", undefined)).resolves.toBe("done");
	});

	it("should settle on a live abort and remove its listener", async () => {
		expect.assertions(2);

		const controller = new AbortController();
		const removeListener = vi.spyOn(controller.signal, "removeEventListener");
		const pending = raceWithAbortAsync(
			async () => new Promise<void>(() => {}),
			controller.signal,
		);

		controller.abort();

		await expect(pending).resolves.toBe(ABORTED);
		expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
	});

	it("should propagate an operation failure and remove its listener", async () => {
		expect.assertions(2);

		const controller = new AbortController();
		const removeListener = vi.spyOn(controller.signal, "removeEventListener");
		const failure = new Error("failed");

		await expect(
			raceWithAbortAsync(async () => {
				throw failure;
			}, controller.signal),
		).rejects.toBe(failure);
		expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
	});
});
