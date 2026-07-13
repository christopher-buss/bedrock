import { describe, expect, it } from "vitest";

import { safeStringify } from "./error-chain.ts";

describe(safeStringify, () => {
	it("should render a bare error as its own message", () => {
		expect.assertions(1);

		expect(safeStringify(new Error("boom"))).toBe("boom");
	});

	it("should join a cause chain with a caused-by separator", () => {
		expect.assertions(1);

		const err = new Error("outer", {
			cause: new Error("middle", { cause: new Error("inner") }),
		});

		expect(safeStringify(err)).toBe("outer; caused by: middle; caused by: inner");
	});

	it("should stop walking the cause chain at the depth cap", () => {
		expect.assertions(1);

		let chain: Error = new Error("root");
		for (let index = 0; index < 6; index += 1) {
			chain = new Error(`wrap ${String(index)}`, { cause: chain });
		}

		expect(safeStringify(chain)).toBe(
			"wrap 5; caused by: wrap 4; caused by: wrap 3; caused by: wrap 2; caused by: wrap 1",
		);
	});

	it("should stop walking a self-referential cause chain rather than loop forever", () => {
		expect.assertions(1);

		const cyclic = new Error("loop");
		cyclic.cause = cyclic;

		expect(safeStringify(cyclic)).toBe(
			"loop; caused by: loop; caused by: loop; caused by: loop; caused by: loop",
		);
	});

	it("should render a non-error cause and stop the chain", () => {
		expect.assertions(1);

		const err = new Error("outer", { cause: "string reason" });

		expect(safeStringify(err)).toBe("outer; caused by: string reason");
	});

	it("should render a non-error cause reached after walking error causes", () => {
		expect.assertions(1);

		const err = new Error("outer", { cause: new Error("middle", { cause: 42 }) });

		expect(safeStringify(err)).toBe("outer; caused by: middle; caused by: 42");
	});

	it("should stringify a non-error value", () => {
		expect.assertions(1);

		expect(safeStringify("plain string")).toBe("plain string");
	});

	it("should fall back to a placeholder when a value cannot be stringified", () => {
		expect.assertions(1);

		const hostile = Object.create(null) as { toString: () => string };
		hostile.toString = () => {
			throw new Error("no coercion");
		};

		expect(safeStringify(hostile)).toBe("<unprintable cause>");
	});
});
