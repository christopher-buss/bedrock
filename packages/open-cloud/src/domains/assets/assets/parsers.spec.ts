import { assert, describe, it } from "vitest";

import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import {
	parseAssetIconResponse,
	parseAssetOperationResponse,
	parseAssetResponse,
} from "./parsers.ts";

describe(parseAssetResponse, () => {
	it.for([
		{ body: { assetId: "456" }, label: "no moderation state" },
		{ body: { moderationResult: { moderationState: "Approved" } }, label: "no asset id" },
		{
			body: { assetId: "456", moderationResult: { moderationState: "Pending" } },
			label: "an undeclared moderation state",
		},
	])("should reject a body with $label as malformed", ({ body }, { expect }) => {
		expect.assertions(3);

		const result = parseAssetResponse({ body, headers: {}, status: 200 });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toBe("Malformed asset response");
		expect(result.err).toMatchObject({ details: body, statusCode: 200 });
	});
});

describe(parseAssetIconResponse, () => {
	it.for([
		{ body: [], label: "a body that is not an object" },
		{ body: { icon: 789 }, label: "an icon that is not a string" },
		{ body: { icon: "789" }, label: "an icon that is not an asset path" },
		{ body: { icon: "assets/" }, label: "an icon path with no asset id" },
	])("should reject $label as malformed", ({ body }, { expect }) => {
		expect.assertions(3);

		const result = parseAssetIconResponse({ body, headers: {}, status: 200 });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toBe("Malformed asset icon response");
		expect(result.err).toMatchObject({ details: body, statusCode: 200 });
	});
});

describe(parseAssetOperationResponse, () => {
	it.for([
		{ body: [], label: "a body that is not an object" },
		{ body: { done: true }, label: "no operation id" },
		{ body: { done: "yes", operationId: "op" }, label: "a done flag that is not a boolean" },
		{
			body: { done: true, error: "boom", operationId: "op" },
			label: "an error that is not an object",
		},
		{
			body: { done: true, error: { code: 3 }, operationId: "op" },
			label: "an error code that is not a string",
		},
		{
			body: { done: true, error: { message: 3 }, operationId: "op" },
			label: "an error message that is not a string",
		},
	])("should reject $label as malformed", ({ body }, { expect }) => {
		expect.assertions(3);

		const result = parseAssetOperationResponse({ body, headers: {}, status: 200 });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(UnexpectedResponseError);
		expect(result.err.message).toBe("Malformed asset operation response");
		expect(result.err).toMatchObject({ details: body, statusCode: 200 });
	});

	it("should read an absent done flag and an empty error as not done with no detail", ({
		expect,
	}) => {
		expect.assertions(1);

		const result = parseAssetOperationResponse({
			body: { error: {}, operationId: "op" },
			headers: {},
			status: 200,
		});

		expect(result).toStrictEqual({
			data: {
				done: false,
				error: { code: undefined, message: undefined },
				operationId: "op",
				response: undefined,
				statusCode: 200,
			},
			success: true,
		});
	});
});
