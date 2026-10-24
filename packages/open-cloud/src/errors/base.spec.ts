import { describe, expectTypeOf, it } from "vitest";

import { ApiError } from "./api-error.ts";
import { OpenCloudError, recordPreviousAttempts } from "./base.ts";
import type { ValidationErrorCode } from "./validation.ts";
import { ValidationError } from "./validation.ts";

describe(OpenCloudError, () => {
	it("should have no previous attempts unless recorded", ({ expect }) => {
		expect.assertions(1);

		const error = new OpenCloudError("test");

		expect(error.previousAttempts).toBeEmpty();
	});

	it("should expose recorded previous attempts as a frozen copy", ({ expect }) => {
		expect.assertions(2);

		const earlier = [new OpenCloudError("first")];
		const error = recordPreviousAttempts(new OpenCloudError("last"), earlier);
		earlier.push(new OpenCloudError("late"));

		expect(error.previousAttempts.map(({ message }) => message)).toStrictEqual(["first"]);
		expect(Object.isFrozen(error.previousAttempts)).toBeTrue();
	});

	it("should expose a frozen empty array when nothing was recorded", ({ expect }) => {
		expect.assertions(1);

		const error = new OpenCloudError("x");

		expect(Object.isFrozen(error.previousAttempts)).toBeTrue();
	});

	it("should store code when provided", ({ expect }) => {
		expect.assertions(1);

		const error = new OpenCloudError("test", { code: "NOT_FOUND" });

		expect(error.code).toBe("NOT_FOUND");
	});

	it("should have undefined code when not provided", ({ expect }) => {
		expect.assertions(1);

		const error = new OpenCloudError("test");

		expect(error.code).toBeUndefined();
	});

	it("should read a subclass code through the base type without a narrow", ({ expect }) => {
		expect.assertions(2);

		const errors: ReadonlyArray<OpenCloudError> = [
			new ApiError("HTTP 404", { code: "NOT_FOUND", statusCode: 404 }),
			new ValidationError("Place body is empty", { code: "empty_body" }),
		];

		expectTypeOf<OpenCloudError["code"]>().toEqualTypeOf<string | undefined>();

		expect(errors.map((error) => error.code)).toStrictEqual(["NOT_FOUND", "empty_body"]);
		expect(errors.filter((error) => error.code === "NOT_FOUND")).toHaveLength(1);
	});

	it("should keep the validation code narrowed to its closed union", ({ expect }) => {
		expect.assertions(1);

		const error = new ValidationError("Place body is empty", { code: "empty_body" });

		expectTypeOf<ValidationError["code"]>().toEqualTypeOf<ValidationErrorCode>();

		expect(error.code).toBe("empty_body");
	});

	it("should set name to OpenCloudError", ({ expect }) => {
		expect.assertions(1);

		const error = new OpenCloudError("test");

		expect(error.name).toBe("OpenCloudError");
	});

	it("should set message from constructor argument", ({ expect }) => {
		expect.assertions(1);

		const error = new OpenCloudError("something went wrong");

		expect(error.message).toBe("something went wrong");
	});

	it("should be an instance of Error", ({ expect }) => {
		expect.assertions(1);

		const error = new OpenCloudError("test");

		expect(error).toBeInstanceOf(Error);
	});

	it("should store cause when provided", ({ expect }) => {
		expect.assertions(1);

		const cause = new Error("original");
		const error = new OpenCloudError("wrapped", { cause });

		expect(error.cause).toBe(cause);
	});

	it("should have undefined cause when not provided", ({ expect }) => {
		expect.assertions(1);

		const error = new OpenCloudError("test");

		expect(error.cause).toBeUndefined();
	});
});
