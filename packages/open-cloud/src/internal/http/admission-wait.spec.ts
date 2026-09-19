import { describe, expect, it, vi } from "vitest";

import type { AdmissionWait } from "../../client/types.ts";
import { AdmissionWaitSpan } from "./admission-wait.ts";

function createObserver(): {
	readonly observer: (wait: AdmissionWait) => void;
	readonly waits: ReadonlyArray<AdmissionWait>;
} {
	const waits: Array<AdmissionWait> = [];
	return {
		observer(wait) {
			waits.push(wait);
		},
		waits,
	};
}

describe(AdmissionWaitSpan, () => {
	it("should pair a start carrying the duration with an end carrying the same", () => {
		expect.assertions(1);

		const { observer, waits } = createObserver();
		const span = new AdmissionWaitSpan(observer, "retry-delay");

		span.begin(1500);
		span.end();

		expect(waits).toStrictEqual([
			{ phase: "start", reason: "retry-delay", waitMs: 1500 },
			{ phase: "end", reason: "retry-delay", waitMs: 1500 },
		]);
	});

	it("should omit the duration of a wait whose schedule is not known", () => {
		expect.assertions(1);

		const { observer, waits } = createObserver();
		const span = new AdmissionWaitSpan(observer, "operation-queue");

		span.begin();
		span.end();

		expect(waits).toStrictEqual([
			{ phase: "start", reason: "operation-queue" },
			{ phase: "end", reason: "operation-queue" },
		]);
	});

	it("should report one wait when a running wait is begun again", () => {
		expect.assertions(1);

		const { observer, waits } = createObserver();
		const span = new AdmissionWaitSpan(observer, "reported-budget");

		span.begin();
		span.begin(250);
		span.end();

		expect(waits).toStrictEqual([
			{ phase: "start", reason: "reported-budget" },
			{ phase: "end", reason: "reported-budget" },
		]);
	});

	it("should report nothing for a wait that never began", () => {
		expect.assertions(1);

		const observer = vi.fn<(wait: AdmissionWait) => void>();
		const span = new AdmissionWaitSpan(observer, "operation-queue");

		span.end();

		expect(observer).not.toHaveBeenCalled();
	});

	it("should end a wait exactly once however often it is ended", () => {
		expect.assertions(1);

		const { observer, waits } = createObserver();
		const span = new AdmissionWaitSpan(observer, "operation-queue");

		span.begin(100);
		span.end();
		span.end();

		expect(waits).toHaveLength(2);
	});

	it("should stay ended when a settled request is begun again", () => {
		expect.assertions(1);

		const { observer, waits } = createObserver();
		const span = new AdmissionWaitSpan(observer, "operation-queue");

		span.begin(100);
		span.end();
		span.begin(200);

		expect(waits).toStrictEqual([
			{ phase: "start", reason: "operation-queue", waitMs: 100 },
			{ phase: "end", reason: "operation-queue", waitMs: 100 },
		]);
	});

	it("should keep reporting after an observer throws", () => {
		expect.assertions(1);

		const observer = vi.fn<(wait: AdmissionWait) => void>(() => {
			throw new Error("observer failure");
		});
		const span = new AdmissionWaitSpan(observer, "retry-delay");

		span.begin(10);
		span.end();

		expect(observer).toHaveBeenCalledTimes(2);
	});

	it("should report nothing when the request supplied no observer", () => {
		expect.assertions(1);

		const span = new AdmissionWaitSpan(undefined, "retry-delay");

		expect(() => {
			span.begin(10);
			span.end();
		}).not.toThrow();
	});
});
