import { describe, expect, it } from "vitest";

import { createNoOpProgressAdapter } from "./no-op-progress-adapter.ts";

describe(createNoOpProgressAdapter, () => {
	it("should drop a deploySuccess event without throwing", () => {
		expect.assertions(1);

		const port = createNoOpProgressAdapter();

		expect(() => {
			port.emit({ environment: "production", kind: "deploySuccess", resourceCount: 3 });
		}).not.toThrow();
	});

	it("should drop a deployFailure event without throwing", () => {
		expect.assertions(1);

		const port = createNoOpProgressAdapter();

		expect(() => {
			port.emit({
				environment: "production",
				error: {
					declared: ["production"],
					environment: "ghost",
					kind: "unknownEnvironment",
				},
				kind: "deployFailure",
			});
		}).not.toThrow();
	});

	it("should produce independent instances on each call", () => {
		expect.assertions(1);

		const first = createNoOpProgressAdapter();
		const second = createNoOpProgressAdapter();

		expect(first).not.toBe(second);
	});
});
