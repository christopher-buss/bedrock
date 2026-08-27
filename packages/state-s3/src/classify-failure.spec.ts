import { describe, expect, it } from "vitest";

import { classifyS3Failure, isConditionRefusal } from "./classify-failure.ts";

/**
 * The shape the S3 client throws: a named error carrying the HTTP status
 * the store answered with.
 */
class S3Refusal extends Error {
	public readonly $metadata: { httpStatusCode: number | undefined };
	public override readonly name: string;

	constructor(code: string, httpStatusCode?: number) {
		super(`the store refused with ${code}`);
		this.$metadata = { httpStatusCode };
		this.name = code;
	}
}

/**
 * Build one refusal to classify.
 *
 * @param name - Error name the client deserialized from the store.
 * @param httpStatusCode - Status the store answered with.
 * @returns The error to classify.
 */
function s3Error(name: string, httpStatusCode?: number): Error {
	return new S3Refusal(name, httpStatusCode);
}

describe(classifyS3Failure, () => {
	it.for([
		["NoSuchKey", "missingObject"],
		["NoSuchBucket", "missingStore"],
		["AccessDenied", "accessDenied"],
		["CredentialsProviderError", "missingCredentials"],
		["PreconditionFailed", "conditionRefused"],
		["ConditionalRequestConflict", "conditionRefused"],
	] as const)("should read %s as a %s failure", ([name, kind]) => {
		expect.assertions(1);

		expect(classifyS3Failure(s3Error(name)).kind).toBe(kind);
	});

	it("should read a refusal it knows only by its 403 as access denied", () => {
		expect.assertions(1);

		expect(classifyS3Failure(s3Error("SignatureDoesNotMatch", 403)).kind).toBe("accessDenied");
	});

	it("should refuse to read a bare 404 as an environment that was never deployed", () => {
		expect.assertions(1);

		expect(classifyS3Failure(s3Error("NotFound", 404)).kind).toBe("requestFailed");
	});

	it("should read a refusal it recognizes neither by name nor by status as a request failure", () => {
		expect.assertions(3);

		const failure = classifyS3Failure(s3Error("SlowDown", 503));

		expect(failure.kind).toBe("requestFailed");
		expect(failure.name).toBe("SlowDown");
		expect(failure.statusCode).toBe(503);
	});

	it("should report the store's own message as the reason", () => {
		expect.assertions(1);

		expect(classifyS3Failure(s3Error("AccessDenied", 403)).reason).toBe(
			"the store refused with AccessDenied",
		);
	});

	it("should classify something thrown that is not an error at all", () => {
		expect.assertions(3);

		const failure = classifyS3Failure("the transport exploded");

		expect(failure.kind).toBe("requestFailed");
		expect(failure.name).toBe("Error");
		expect(failure.reason).toBe("the transport exploded");
	});

	it("should name the status as absent when the refusal never reached the store", () => {
		expect.assertions(1);

		expect(classifyS3Failure(s3Error("CredentialsProviderError")).statusCode).toBeUndefined();
	});
});

describe(isConditionRefusal, () => {
	it.for(["PreconditionFailed", "ConditionalRequestConflict"] as const)(
		"should read %s as the store declining the condition",
		(name) => {
			expect.assertions(1);

			expect(isConditionRefusal(classifyS3Failure(s3Error(name)))).toBeTrue();
		},
	);

	it.for([409, 412] as const)(
		"should read a %d the client did not model as the store declining the condition",
		(status) => {
			expect.assertions(1);

			expect(
				isConditionRefusal(
					classifyS3Failure(s3Error("SomeCodeTheClientDoesNotName", status)),
				),
			).toBeTrue();
		},
	);

	it("should read a refusal that carries no status as something other than the condition", () => {
		expect.assertions(1);

		expect(
			isConditionRefusal(classifyS3Failure(new Error("the transport gave up"))),
		).toBeFalse();
	});

	it("should leave a status the store answers for other reasons alone", () => {
		expect.assertions(1);

		expect(isConditionRefusal(classifyS3Failure(s3Error("AccessDenied", 403)))).toBeFalse();
	});
});
