import { describe, expect, it } from "vitest";

import {
	CREATE_OPERATION_LIMIT,
	CREATE_REQUIRED_SCOPES,
	UPDATE_OPERATION_LIMIT,
	UPDATE_REQUIRED_SCOPES,
} from "./operations.ts";

describe("badges operation limits", () => {
	it("should cap the create endpoint at 100 requests per minute on its own bucket", () => {
		expect.assertions(1);

		expect(CREATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "badges.create",
		});
	});

	it("should cap the update endpoint at 100 requests per minute on its own bucket", () => {
		expect.assertions(1);

		expect(UPDATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "badges.update",
		});
	});
});

describe("badges required scopes", () => {
	it("should require legacy-universe.badge:manage-and-spend-robux to create a badge", () => {
		expect.assertions(1);

		expect(CREATE_REQUIRED_SCOPES).toStrictEqual([
			"legacy-universe.badge:manage-and-spend-robux",
		]);
	});

	it("should require legacy-universe.badge:write to update a badge", () => {
		expect.assertions(1);

		expect(UPDATE_REQUIRED_SCOPES).toStrictEqual(["legacy-universe.badge:write"]);
	});
});
