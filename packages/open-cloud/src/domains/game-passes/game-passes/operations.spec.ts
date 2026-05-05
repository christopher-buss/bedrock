import { describe, expect, it } from "vitest";

import {
	CREATE_OPERATION_LIMIT,
	CREATE_REQUIRED_SCOPES,
	GET_OPERATION_LIMIT,
	GET_REQUIRED_SCOPES,
	LIST_OPERATION_LIMIT,
	LIST_REQUIRED_SCOPES,
	UPDATE_OPERATION_LIMIT,
	UPDATE_REQUIRED_SCOPES,
} from "./operations.ts";

describe("game-passes operation limits", () => {
	it("should cap the read endpoint at 10 requests per second", () => {
		expect.assertions(1);

		expect(GET_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 10,
			operationKey: "game-passes.get",
		});
	});

	it("should cap the create endpoint at 5 requests per second", () => {
		expect.assertions(1);

		expect(CREATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 5,
			operationKey: "game-passes.create",
		});
	});

	it("should cap the update endpoint at 5 requests per second", () => {
		expect.assertions(1);

		expect(UPDATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 5,
			operationKey: "game-passes.update",
		});
	});

	it("should cap the list endpoint at 10 requests per second", () => {
		expect.assertions(1);

		expect(LIST_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 10,
			operationKey: "game-passes.list",
		});
	});
});

describe("game-passes required scopes", () => {
	it("should require game-pass:read for the read endpoint", () => {
		expect.assertions(1);

		expect(GET_REQUIRED_SCOPES).toStrictEqual(["game-pass:read"]);
	});

	it("should require game-pass:write for the create endpoint", () => {
		expect.assertions(1);

		expect(CREATE_REQUIRED_SCOPES).toStrictEqual(["game-pass:write"]);
	});

	it("should require game-pass:write for the update endpoint", () => {
		expect.assertions(1);

		expect(UPDATE_REQUIRED_SCOPES).toStrictEqual(["game-pass:write"]);
	});

	it("should require game-pass:read for the list endpoint", () => {
		expect.assertions(1);

		expect(LIST_REQUIRED_SCOPES).toStrictEqual(["game-pass:read"]);
	});
});
