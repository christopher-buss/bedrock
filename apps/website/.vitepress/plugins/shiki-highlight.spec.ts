import { describe, expect, it } from "vitest";

import { buildHighlightError } from "./shiki-highlight.ts";

describe(buildHighlightError, () => {
	it("should prefix the message with the plugin name and file path", () => {
		expect.assertions(1);

		const error = buildHighlightError("/src/samples/deploy.ts", new Error("boom"));

		expect(error.message).toBe("shiki-highlight: /src/samples/deploy.ts: boom");
	});

	it("should keep the original error as the cause so its stack survives", () => {
		expect.assertions(1);

		const original = new Error("ENOENT: no such file");
		const error = buildHighlightError("/src/samples/deploy.ts", original);

		expect(error.cause).toBe(original);
	});

	it("should stringify and carry a non-error throw", () => {
		expect.assertions(2);

		const error = buildHighlightError("/src/samples/deploy.ts", "weird failure");

		expect(error.message).toBe("shiki-highlight: /src/samples/deploy.ts: weird failure");
		expect(error.cause).toBe("weird failure");
	});

	it("should not throw when the thrown value resists string coercion", () => {
		expect.assertions(2);

		const hostile = Object.create(null) as { toString: () => string };
		hostile.toString = () => {
			throw new Error("no coercion");
		};

		const error = buildHighlightError("/src/samples/deploy.ts", hostile);

		expect(error.message).toBe("shiki-highlight: /src/samples/deploy.ts: <unprintable value>");
		expect(error.cause).toBe(hostile);
	});
});
