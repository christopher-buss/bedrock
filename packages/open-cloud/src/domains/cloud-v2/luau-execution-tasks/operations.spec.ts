import { describe, expect, it } from "vitest";

import {
	GET_OPERATION_LIMIT,
	GET_REQUIRED_SCOPES,
	SUBMIT_OPERATION_LIMIT,
	SUBMIT_REQUIRED_SCOPES,
} from "./operations.ts";

describe("luau-execution-tasks submit operation limit", () => {
	it("should cap submit at 40 requests per minute under the luau-execution-tasks.submit key", () => {
		expect.assertions(1);

		expect(SUBMIT_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 40 / 60,
			operationKey: "luau-execution-tasks.submit",
		});
	});
});

describe("luau-execution-tasks get operation limit", () => {
	it("should cap get at 200 requests per minute under the luau-execution-tasks.get key", () => {
		expect.assertions(1);

		expect(GET_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 200 / 60,
			operationKey: "luau-execution-tasks.get",
		});
	});
});

describe("luau-execution-tasks required scopes", () => {
	it("should require the :write scope to submit a task", () => {
		expect.assertions(1);

		expect(SUBMIT_REQUIRED_SCOPES).toStrictEqual([
			"universe.place.luau-execution-session:write",
		]);
	});

	it("should require the :read scope to get a task", () => {
		expect.assertions(1);

		expect(GET_REQUIRED_SCOPES).toStrictEqual(["universe.place.luau-execution-session:read"]);
	});
});
