import { describe, expect, it } from "vitest";

import { cyclicError } from "#tests/helpers/errors";
import { findTransportCode } from "./transport-code.ts";

describe(findTransportCode, () => {
	it("should return the first string code found on the cause chain", () => {
		expect.assertions(1);

		const error = new TypeError("fetch failed", {
			cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
		});

		expect(findTransportCode(error)).toBe("ECONNRESET");
	});

	it("should return the code from the error itself before walking the chain", () => {
		expect.assertions(1);

		const error = Object.assign(
			new Error("outer", { cause: Object.assign(new Error("inner"), { code: "ETIMEDOUT" }) }),
			{ code: "ECONNREFUSED" },
		);

		expect(findTransportCode(error)).toBe("ECONNREFUSED");
	});

	it("should skip a non-string code and keep walking the chain", () => {
		expect.assertions(1);

		const error = Object.assign(
			new Error("outer", { cause: Object.assign(new Error("inner"), { code: "ETIMEDOUT" }) }),
			{ code: 42 },
		);

		expect(findTransportCode(error)).toBe("ETIMEDOUT");
	});

	it("should return undefined when no string code exists on the chain", () => {
		expect.assertions(1);

		expect(
			findTransportCode(new Error("plain", { cause: new Error("also plain") })),
		).toBeUndefined();
	});

	it("should return undefined for a non-error value", () => {
		expect.assertions(1);

		expect(findTransportCode("not an error")).toBeUndefined();
	});

	it("should not read a code that sits beyond the depth cap", () => {
		expect.assertions(1);

		let chain: Error = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
		for (let index = 0; index < 5; index += 1) {
			chain = new Error(`wrap ${String(index)}`, { cause: chain });
		}

		expect(findTransportCode(chain)).toBeUndefined();
	});

	it("should stop walking a self-referential cause chain rather than loop forever", () => {
		expect.assertions(1);

		const cyclic = cyclicError("loop");

		expect(findTransportCode(cyclic)).toBeUndefined();
	});
});
