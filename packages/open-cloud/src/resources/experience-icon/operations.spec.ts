import { describe, expect, it } from "vitest";

import {
	DELETE_ICON_OPERATION_LIMIT,
	LIST_ICONS_OPERATION_LIMIT,
	UPLOAD_ICON_OPERATION_LIMIT,
} from "./operations.ts";

describe("experience-icon operation limits", () => {
	it("should cap the upload endpoint at 5 requests per second", () => {
		expect.assertions(1);

		expect(UPLOAD_ICON_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 5,
			operationKey: "experience-icon.upload",
		});
	});

	it("should cap the delete endpoint at 5 requests per second", () => {
		expect.assertions(1);

		expect(DELETE_ICON_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 5,
			operationKey: "experience-icon.delete",
		});
	});

	it("should cap the list endpoint at 10 requests per second", () => {
		expect.assertions(1);

		expect(LIST_ICONS_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 10,
			operationKey: "experience-icon.list",
		});
	});

	it("should freeze each operation limit so callers cannot mutate the registry", () => {
		expect.assertions(3);

		expect(Object.isFrozen(UPLOAD_ICON_OPERATION_LIMIT)).toBeTrue();
		expect(Object.isFrozen(DELETE_ICON_OPERATION_LIMIT)).toBeTrue();
		expect(Object.isFrozen(LIST_ICONS_OPERATION_LIMIT)).toBeTrue();
	});
});
