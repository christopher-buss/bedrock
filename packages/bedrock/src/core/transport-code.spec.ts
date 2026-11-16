import { describe, it } from "vitest";

import { cyclicError } from "#tests/helpers/errors";
import { findTransportCode, isRequestTimeout } from "./transport-code.ts";

describe(findTransportCode, () => {
	it("should return the first string code found on the cause chain", ({ expect }) => {
		expect.assertions(1);

		const error = new TypeError("fetch failed", {
			cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
		});

		expect(findTransportCode(error)).toBe("ECONNRESET");
	});

	it("should return the code from the error itself before walking the chain", ({ expect }) => {
		expect.assertions(1);

		const error = Object.assign(
			new Error("outer", { cause: Object.assign(new Error("inner"), { code: "ETIMEDOUT" }) }),
			{ code: "ECONNREFUSED" },
		);

		expect(findTransportCode(error)).toBe("ECONNREFUSED");
	});

	it("should skip a non-string code and keep walking the chain", ({ expect }) => {
		expect.assertions(1);

		const error = Object.assign(
			new Error("outer", { cause: Object.assign(new Error("inner"), { code: "ETIMEDOUT" }) }),
			{ code: 42 },
		);

		expect(findTransportCode(error)).toBe("ETIMEDOUT");
	});

	it("should return undefined when no string code exists on the chain", ({ expect }) => {
		expect.assertions(1);

		expect(
			findTransportCode(new Error("plain", { cause: new Error("also plain") })),
		).toBeUndefined();
	});

	it("should return undefined for a non-error value", ({ expect }) => {
		expect.assertions(1);

		expect(findTransportCode("not an error")).toBeUndefined();
	});

	it("should not read a code that sits beyond the depth cap", ({ expect }) => {
		expect.assertions(1);

		let chain: Error = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
		for (let index = 0; index < 5; index += 1) {
			chain = new Error(`wrap ${String(index)}`, { cause: chain });
		}

		expect(findTransportCode(chain)).toBeUndefined();
	});

	it("should stop walking a self-referential cause chain rather than loop forever", ({
		expect,
	}) => {
		expect.assertions(1);

		const cyclic = cyclicError("loop");

		expect(findTransportCode(cyclic)).toBeUndefined();
	});
});

describe(isRequestTimeout, () => {
	it("should find the timeout under a network failure", ({ expect }) => {
		expect.assertions(1);

		const error = new Error("Network request failed", {
			cause: new DOMException("The operation timed out.", "TimeoutError"),
		});

		expect(isRequestTimeout(error)).toBeTrue();
	});

	it("should find a timeout at the last link the depth cap reads", ({ expect }) => {
		expect.assertions(1);

		let chain: Error = new DOMException("The operation timed out.", "TimeoutError");
		for (let index = 0; index < 4; index += 1) {
			chain = new Error(`wrap ${String(index)}`, { cause: chain });
		}

		expect(isRequestTimeout(chain)).toBeTrue();
	});

	it("should not read a timeout that sits beyond the depth cap", ({ expect }) => {
		expect.assertions(1);

		let chain: Error = new DOMException("The operation timed out.", "TimeoutError");
		for (let index = 0; index < 5; index += 1) {
			chain = new Error(`wrap ${String(index)}`, { cause: chain });
		}

		expect(isRequestTimeout(chain)).toBeFalse();
	});

	it("should be false for a chain without a timeout or a non-error value", ({ expect }) => {
		expect.assertions(2);

		expect(isRequestTimeout(new Error("plain", { cause: new Error("reset") }))).toBeFalse();
		expect(isRequestTimeout("TimeoutError")).toBeFalse();
	});
});
