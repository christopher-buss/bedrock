import { describe, it } from "vitest";

import {
	CREATE_OPERATION_LIMIT,
	CREATE_REQUIRED_SCOPES,
	GET_OPERATION_LIMIT,
	READ_BASE_URL,
	UPDATE_OPERATION_LIMIT,
	UPDATE_REQUIRED_SCOPES,
} from "./operations.ts";

describe("badges operation limits", () => {
	it("should cap the create endpoint at 100 requests per minute on its own bucket", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(CREATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "badges.create",
		});
	});

	it("should cap the update endpoint at 100 requests per minute on its own bucket", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(UPDATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "badges.update",
		});
	});
});

describe("badges read operations", () => {
	it("should pace badge reads at 600 per minute on their own bucket", ({ expect }) => {
		expect.assertions(1);

		expect(GET_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 600 / 60,
			operationKey: "badges.get",
		});
	});

	it("should read badges from the unauthenticated badges origin", ({ expect }) => {
		expect.assertions(1);

		expect(READ_BASE_URL).toBe("https://badges.roblox.com");
	});
});

describe("badges required scopes", () => {
	it("should require legacy-universe.badge:manage-and-spend-robux to create a badge", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(CREATE_REQUIRED_SCOPES).toStrictEqual([
			"legacy-universe.badge:manage-and-spend-robux",
		]);
	});

	it("should require legacy-universe.badge:write to update a badge", ({ expect }) => {
		expect.assertions(1);

		expect(UPDATE_REQUIRED_SCOPES).toStrictEqual(["legacy-universe.badge:write"]);
	});
});
