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

	it("should render an html gateway error as a summarized one-line diagnostic", () => {
		expect.assertions(1);

		const err = new ApiError("HTTP 400", {
			elapsedMs: 74_700,
			gatewaySummary: "400 Bad request",
			method: "POST",
			responseHeaders: { server: "haproxy" },
			statusCode: 400,
			url: "https://apis.roblox.com/universes/v1/1/places/2/versions",
		});

		expect(describeDriverCause(err)).toBe(
			'HTTP 400 from gateway ("400 Bad request") on POST https://apis.roblox.com/universes/v1/1/places/2/versions after 74.7s — request rejected before reaching Open Cloud (server=haproxy)',
		);
	});

	it("should bound an oversized gateway summary to 500 characters", () => {
		expect.assertions(1);

		const err = new ApiError("HTTP 400", {
			gatewaySummary: "x".repeat(501),
			statusCode: 400,
		});

		expect(describeDriverCause(err)).toBe(
			`HTTP 400 from gateway ("${"x".repeat(500)}…") — request rejected before reaching Open Cloud`,
		);
	});

	it("should append the call target, elapsed time, and headers to a json api error without re-dumping the body", () => {
		expect.assertions(1);

		const err = new ApiError("HTTP 500: An error occurred while processing your request.", {
			details: { message: "An error occurred while processing your request." },
			elapsedMs: 40_200,
			method: "POST",
			responseHeaders: { "server": "public-gateway", "x-roblox-edge": "c173" },
			statusCode: 500,
			url: "https://apis.roblox.com/universes/v1/1/places/2/versions",
		});

		expect(describeDriverCause(err)).toBe(
			"HTTP 500: An error occurred while processing your request. on POST https://apis.roblox.com/universes/v1/1/places/2/versions after 40.2s (server=public-gateway, x-roblox-edge=c173)",
		);
	});

	it("should keep the body dump for a bare status and still append the call target and elapsed time", () => {
		expect.assertions(1);

		const err = new ApiError("HTTP 400", {
			details: { errorCode: "InvalidArgument" },
			elapsedMs: 1_500,
			method: "POST",
			statusCode: 400,
			url: "https://apis.roblox.com/x",
		});

		expect(describeDriverCause(err)).toBe(
			'HTTP 400 (body: {"errorCode":"InvalidArgument"}) on POST https://apis.roblox.com/x after 1.5s',
		);
	});

	it("should still dump the body for a non-status message that happens to contain a colon", () => {
		expect.assertions(1);

		const err = new ApiError("Failed to parse response body (content-type: application/json)", {
			details: "not json",
			statusCode: 200,
		});

		expect(describeDriverCause(err)).toBe(
			"Failed to parse response body (content-type: application/json) (body: not json)",
		);
	});

	it("should bound an oversized diagnostic-header summary to 500 characters", () => {
		expect.assertions(1);

		const err = new ApiError("HTTP 500: boom", {
			responseHeaders: { server: "x".repeat(501) },
			statusCode: 500,
		});

		expect(describeDriverCause(err)).toBe(`HTTP 500: boom (server=${"x".repeat(493)}…)`);
	});

	it("should omit the header summary when no diagnostic headers were captured", () => {
		expect.assertions(1);

		const err = new ApiError("HTTP 500: boom", {
			elapsedMs: 2_000,
			method: "GET",
			responseHeaders: {},
			statusCode: 500,
			url: "https://apis.roblox.com/y",
		});

		expect(describeDriverCause(err)).toBe(
			"HTTP 500: boom on GET https://apis.roblox.com/y after 2.0s",
		);
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
