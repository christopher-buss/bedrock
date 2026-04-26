import { describe, expect, it } from "vitest";

import { CREATE_OPERATION_LIMIT, GET_OPERATION_LIMIT } from "./operations.ts";

describe("developer-products operation limits", () => {
	it("should cap the read endpoint at 10 requests per second", () => {
		expect.assertions(1);

		expect(GET_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 10,
			operationKey: "developer-products.get",
		});
	});

	it("should cap the create endpoint at 3 requests per second", () => {
		expect.assertions(1);

		expect(CREATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 3,
			operationKey: "developer-products.create",
		});
	});
});
