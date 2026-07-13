import { ApiError, NetworkError } from "@bedrock-rbx/ocale";

import { describe, expect, it } from "vitest";

import { describeDriverCause } from "./failure-detail.ts";

describe(describeDriverCause, () => {
	it("should expand a network error with its transport code and failing call", () => {
		expect.assertions(1);

		const err = new NetworkError("Network request failed", {
			cause: new TypeError("fetch failed", {
				cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
			}),
			method: "POST",
			url: "https://apis.roblox.com/v2/places/1",
		});

		expect(describeDriverCause(err)).toBe(
			"Network request failed (ECONNRESET) on POST https://apis.roblox.com/v2/places/1",
		);
	});

	it("should ignore a non-string transport code and keep walking the cause chain", () => {
		expect.assertions(1);

		const err = new NetworkError("Network request failed", {
			cause: Object.assign(new Error("outer"), {
				cause: Object.assign(new Error("inner"), { code: "ETIMEDOUT" }),
				code: 42,
			}),
			method: "GET",
			url: "https://apis.roblox.com/v2/places/1",
		});

		expect(describeDriverCause(err)).toBe(
			"Network request failed (ETIMEDOUT) on GET https://apis.roblox.com/v2/places/1",
		);
	});

	it("should fall back to the cause message when no transport code is present", () => {
		expect.assertions(1);

		const err = new NetworkError("Network request failed", {
			cause: new TypeError("fetch failed"),
			method: "PATCH",
			url: "https://apis.roblox.com/v2/places/1",
		});

		expect(describeDriverCause(err)).toBe(
			"Network request failed (fetch failed) on PATCH https://apis.roblox.com/v2/places/1",
		);
	});

	it.for<{ err: NetworkError; label: string }>([
		{
			err: new NetworkError("Network request failed", {
				cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
				method: "POST",
			}),
			label: "url absent",
		},
		{
			err: new NetworkError("Network request failed", {
				cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
				url: "https://apis.roblox.com/v2/places/1",
			}),
			label: "method absent",
		},
	])("should omit the call target when $label", ({ err }) => {
		expect.assertions(1);

		expect(describeDriverCause(err)).toBe("Network request failed (ECONNRESET)");
	});

	it("should fall back to the bare message when neither a reason nor a target is available", () => {
		expect.assertions(1);

		const err = new NetworkError("Network request failed");

		expect(describeDriverCause(err)).toBe("Network request failed");
	});

	it("should surface a non-network Open Cloud error's own message unchanged", () => {
		expect.assertions(1);

		const err = new ApiError("HTTP 504: gateway timeout", { statusCode: 504 });

		expect(describeDriverCause(err)).toBe("HTTP 504: gateway timeout");
	});

	it("should append an api error's JSON response body so a bare status is diagnosable", () => {
		expect.assertions(1);

		const err = new ApiError("HTTP 400", {
			details: { errors: [{ code: 103, message: "Invalid place file" }] },
			statusCode: 400,
		});

		expect(describeDriverCause(err)).toBe(
			'HTTP 400 (body: {"errors":[{"code":103,"message":"Invalid place file"}]})',
		);
	});

	it("should append a non-JSON response body verbatim", () => {
		expect.assertions(1);

		const err = new ApiError("HTTP 400", {
			details: "<html>Bad Request</html>",
			statusCode: 400,
		});

		expect(describeDriverCause(err)).toBe("HTTP 400 (body: <html>Bad Request</html>)");
	});

	it("should truncate a response body beyond 500 characters with an ellipsis", () => {
		expect.assertions(1);

		const err = new ApiError("HTTP 400", {
			details: "x".repeat(501),
			statusCode: 400,
		});

		expect(describeDriverCause(err)).toBe(`HTTP 400 (body: ${"x".repeat(500)}…)`);
	});

	it("should keep a response body of exactly 500 characters untruncated", () => {
		expect.assertions(1);

		const err = new ApiError("HTTP 400", {
			details: "x".repeat(500),
			statusCode: 400,
		});

		expect(describeDriverCause(err)).toBe(`HTTP 400 (body: ${"x".repeat(500)})`);
	});

	it("should not read a transport code that sits beyond the cause-depth cap", () => {
		expect.assertions(1);

		let chain: Error = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
		for (let index = 0; index < 4; index += 1) {
			chain = new Error(`wrap ${String(index)}`, { cause: chain });
		}

		const err = new NetworkError("Network request failed", {
			cause: chain,
			method: "POST",
			url: "https://apis.roblox.com/v2/places/1",
		});

		expect(describeDriverCause(err)).toBe(
			"Network request failed (wrap 3) on POST https://apis.roblox.com/v2/places/1",
		);
	});

	it("should stop walking a self-referential cause chain rather than loop forever", () => {
		expect.assertions(1);

		const cyclic = new Error("loop");
		cyclic.cause = cyclic;
		const err = new NetworkError("Network request failed", {
			cause: cyclic,
			method: "POST",
			url: "https://apis.roblox.com/v2/places/1",
		});

		expect(describeDriverCause(err)).toBe(
			"Network request failed (loop) on POST https://apis.roblox.com/v2/places/1",
		);
	});
});
