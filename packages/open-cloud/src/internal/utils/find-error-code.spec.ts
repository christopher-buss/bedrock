import { describe, expect, it } from "vitest";

import { findErrorCode } from "./find-error-code.ts";

describe(findErrorCode, () => {
	it("should find a node-style code on the error itself", () => {
		expect.assertions(1);

		const error = Object.assign(new Error("boom"), { code: "ECONNRESET" });

		expect(findErrorCode(error)).toBe("ECONNRESET");
	});

	it("should walk the cause chain to find a deeper code", () => {
		expect.assertions(1);

		const root = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
		const middle = new TypeError("fetch failed", { cause: root });
		const outer = new Error("Network request failed", { cause: middle });

		expect(findErrorCode(outer)).toBe("ECONNRESET");
	});

	it("should return undefined when no error in the chain carries a code", () => {
		expect.assertions(1);

		const outer = new Error("Network request failed", {
			cause: new TypeError("fetch failed"),
		});

		expect(findErrorCode(outer)).toBeUndefined();
	});

	it("should ignore a non-string code and keep walking", () => {
		expect.assertions(1);

		const root = Object.assign(new Error("inner"), { code: "ETIMEDOUT" });
		const outer = Object.assign(new Error("outer"), { cause: root, code: 42 });

		expect(findErrorCode(outer)).toBe("ETIMEDOUT");
	});

	it("should return undefined for a non-Error input", () => {
		expect.assertions(1);

		expect(findErrorCode("ECONNRESET")).toBeUndefined();
	});

	it("should stop walking at the depth cap rather than loop forever", () => {
		expect.assertions(1);

		const cyclic: Error & { code?: unknown } = new Error("loop");
		cyclic.cause = cyclic;

		expect(findErrorCode(cyclic)).toBeUndefined();
	});

	it("should not find a code that sits beyond the depth cap", () => {
		expect.assertions(1);

		// Code lives five links deep; the walk checks shallower links only and
		// must not reach it.
		let chain: Error = Object.assign(new Error("deep"), { code: "ECONNRESET" });
		for (let index = 0; index < 5; index += 1) {
			chain = new Error(`wrap ${String(index)}`, { cause: chain });
		}

		expect(findErrorCode(chain)).toBeUndefined();
	});
});
