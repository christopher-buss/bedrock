import { describe, expect, it } from "vitest";

import type { ProgressEvent } from "../ports/progress-port.ts";
import { createNoOpProgressAdapter } from "./no-op-progress-adapter.ts";

describe(createNoOpProgressAdapter, () => {
	it.for<{ event: ProgressEvent; label: string }>([
		{
			event: { environment: "production", kind: "deploySuccess", resourceCount: 3 },
			label: "deploySuccess",
		},
		{
			event: {
				environment: "production",
				error: {
					declared: ["production"],
					environment: "ghost",
					kind: "unknownEnvironment",
				},
				kind: "deployFailure",
			},
			label: "deployFailure",
		},
	])("should drop a $label event without throwing", ({ event }) => {
		expect.assertions(1);

		const port = createNoOpProgressAdapter();

		expect(() => {
			port.emit(event);
		}).not.toThrow();
	});

	it("should produce independent instances on each call", () => {
		expect.assertions(1);

		const first = createNoOpProgressAdapter();
		const second = createNoOpProgressAdapter();

		expect(first).not.toBe(second);
	});
});
