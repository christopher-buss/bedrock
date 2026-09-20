import { describe, expect, it, vi } from "vitest";

import type { AdmissionWaitObserver } from "../../client/types.ts";
import { observeAdmissionWaitAsync } from "./admission-wait.ts";

describe(observeAdmissionWaitAsync, () => {
	it("should end a started wait exactly once when the wait succeeds", async () => {
		expect.assertions(1);

		const observer = vi.fn<AdmissionWaitObserver>();

		await observeAdmissionWaitAsync({
			durationMs: 250,
			observer,
			reason: "operation-queue",
			waitAsync: async () => {},
		});

		expect(observer.mock.calls).toStrictEqual([
			[{ durationMs: 250, phase: "started", reason: "operation-queue" }],
			[{ durationMs: 250, phase: "ended", reason: "operation-queue" }],
		]);
	});

	it("should end a started wait exactly once when the wait fails", async () => {
		expect.assertions(2);

		const failure = new Error("wait failed");
		const observer = vi.fn<AdmissionWaitObserver>();

		await expect(
			observeAdmissionWaitAsync({
				observer,
				reason: "reported-budget",
				waitAsync: async () => {
					throw failure;
				},
			}),
		).rejects.toBe(failure);

		expect(observer.mock.calls).toStrictEqual([
			[{ phase: "started", reason: "reported-budget" }],
			[{ phase: "ended", reason: "reported-budget" }],
		]);
	});

	it("should not let observer failures change the wait", async () => {
		expect.assertions(2);

		const observer = vi.fn<AdmissionWaitObserver>(() => {
			throw new Error("observer failed");
		});
		const waitAsync = vi.fn<() => Promise<void>>(async () => {});

		await expect(
			observeAdmissionWaitAsync({ observer, reason: "retry-delay", waitAsync }),
		).resolves.toBeUndefined();

		expect(waitAsync).toHaveBeenCalledExactlyOnceWith();
	});

	it("should ignore an asynchronously rejected observer notification", async () => {
		expect.assertions(2);

		const rejectedNotification = Promise.reject<void>(new Error("observer rejected"));
		const catchSpy = vi.spyOn(rejectedNotification, "catch");
		function observeAsync(): unknown {
			return rejectedNotification;
		}

		const observer = vi.fn<AdmissionWaitObserver>(observeAsync);
		const waitAsync = vi.fn<() => Promise<void>>(async () => {});

		await observeAdmissionWaitAsync({
			observer,
			reason: "retry-delay",
			waitAsync,
		});

		expect(waitAsync).toHaveBeenCalledExactlyOnceWith();
		expect(catchSpy).toHaveBeenCalledWith(expect.any(Function));
	});

	it("should contain rejected promise-like observer notifications", async () => {
		expect.assertions(2);

		const then = vi.fn<
			(resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => void
		>((_resolve, reject): void => {
			reject(new Error("observer rejected"));
		});
		const waitAsync = vi.fn<() => Promise<void>>(async () => {});

		await observeAdmissionWaitAsync({
			observer: () => ({ then }),
			reason: "retry-delay",
			waitAsync,
		});
		await Promise.resolve();

		expect(then).toHaveBeenCalledTimes(2);
		expect(waitAsync).toHaveBeenCalledExactlyOnceWith();
	});
});
