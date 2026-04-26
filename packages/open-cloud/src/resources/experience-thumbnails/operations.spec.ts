import { describe, expect, it } from "vitest";

import {
	DELETE_OPERATION_LIMIT,
	REORDER_OPERATION_LIMIT,
	UPLOAD_OPERATION_LIMIT,
} from "./operations.ts";

describe("experience-thumbnails operation limits", () => {
	it("should cap the upload endpoint at 5 requests per second", () => {
		expect.assertions(1);

		expect(UPLOAD_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 5,
			operationKey: "experience-thumbnails.upload",
		});
	});

	it("should cap the delete endpoint at 5 requests per second", () => {
		expect.assertions(1);

		expect(DELETE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 5,
			operationKey: "experience-thumbnails.delete",
		});
	});

	it("should cap the reorder endpoint at 5 requests per second", () => {
		expect.assertions(1);

		expect(REORDER_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 5,
			operationKey: "experience-thumbnails.reorder",
		});
	});

	it("should freeze each operation limit so callers cannot mutate the registry", () => {
		expect.assertions(3);

		expect(Object.isFrozen(UPLOAD_OPERATION_LIMIT)).toBeTrue();
		expect(Object.isFrozen(DELETE_OPERATION_LIMIT)).toBeTrue();
		expect(Object.isFrozen(REORDER_OPERATION_LIMIT)).toBeTrue();
	});
});
