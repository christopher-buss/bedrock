import { ApiError, NetworkError } from "@bedrock-rbx/ocale";

import { describe, it } from "vitest";

import { cyclicError, retriedError, withoutStack } from "#tests/helpers/errors";
import { verboseDetail } from "./verbose-detail.ts";

describe(verboseDetail, () => {
	it("should print nothing for a failure record with no error on its chain", ({ expect }) => {
		expect.assertions(1);

		expect(
			verboseDetail({ cause: { file: "f", kind: "stateError", reason: "r" }, kind: "x" }),
		).toBeEmpty();
	});

	it("should print nothing for a failure record whose cause is null", ({ expect }) => {
		expect.assertions(1);

		expect(verboseDetail({ cause: JSON.parse("null"), kind: "x" })).toBeEmpty();
	});

	it("should print nothing for a thrown string already on the failure line", ({ expect }) => {
		expect.assertions(1);

		expect(verboseDetail("boom")).toBeEmpty();
	});

	it("should print the stack of an error found through a failure record", ({ expect }) => {
		expect.assertions(1);

		const thrown = new Error("kaboom");

		expect(verboseDetail({ cause: thrown, kind: "unexpectedThrow" })).toStrictEqual([
			`caused by: ${thrown.stack}`,
		]);
	});

	it("should print each error on the cause chain, ending at a non-error cause", ({ expect }) => {
		expect.assertions(1);

		const inner = withoutStack(new TypeError("fetch failed", { cause: "socket hang up" }));
		const outer = withoutStack(new NetworkError("Network request failed", { cause: inner }));

		expect(verboseDetail(outer)).toStrictEqual([
			"NetworkError: Network request failed",
			"caused by: TypeError: fetch failed",
			"caused by: socket hang up",
		]);
	});

	it("should list earlier attempts before the error that made them", ({ expect }) => {
		expect.assertions(1);

		const first = new ApiError("HTTP 500", { details: "upstream", statusCode: 500 });
		const second = new NetworkError("Network request failed");
		const last = withoutStack(
			retriedError(new ApiError("HTTP 503", { statusCode: 503 }), [first, second]),
		);

		expect(verboseDetail({ cause: last, kind: "driverFailure" })).toStrictEqual([
			"attempt 1 of 3 failed: HTTP 500 (body: upstream)",
			"attempt 2 of 3 failed: Network request failed",
			"caused by: ApiError: HTTP 503",
		]);
	});

	it("should stop walking a self-referential cause chain", ({ expect }) => {
		expect.assertions(1);

		expect(verboseDetail(withoutStack(cyclicError("loop")))).toHaveLength(5);
	});

	it("should report an unreadable cause without throwing", ({ expect }) => {
		expect.assertions(1);

		const hostile = new Proxy(
			{},
			{
				get: () => {
					throw new Error("no");
				},
			},
		);

		expect(verboseDetail({ cause: hostile, kind: "x" })).toStrictEqual([
			"caused by: <unprintable cause>",
		]);
	});

	it("should report an error whose stack cannot be read without throwing", ({ expect }) => {
		expect.assertions(1);

		const error = new Error("hidden");
		Object.defineProperty(error, "stack", {
			get: () => {
				throw new Error("no");
			},
		});

		expect(verboseDetail({ cause: error, kind: "x" })).toStrictEqual([
			"caused by: <unprintable cause>",
		]);
	});
});
