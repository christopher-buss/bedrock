import { describe, expect, it } from "vitest";

import { tryCatch } from "./try-catch";

describe(tryCatch, () => {
	it("should return success result when promise resolves", async () => {
		expect.assertions(1);

		const result = await tryCatch(Promise.resolve("hello"));

		expect(result).toStrictEqual({ data: "hello", success: true });
	});

	it("should return failure result when promise rejects with an error", async () => {
		expect.assertions(1);

		const error = new Error("boom");
		const result = await tryCatch(Promise.reject(error));

		expect(result).toStrictEqual({ err: error, success: false });
	});

	it("should wrap non-error rejection in an Error instance", async () => {
		expect.assertions(1);

		// eslint-disable-next-line ts/prefer-promise-reject-errors -- intentionally testing non-Error rejection
		const result = await tryCatch(Promise.reject("string failure"));

		expect(result).toStrictEqual({
			err: new Error("string failure"),
			success: false,
		});
	});
});
