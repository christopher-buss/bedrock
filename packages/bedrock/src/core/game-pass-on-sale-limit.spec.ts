import { ApiError, NetworkError } from "@bedrock-rbx/ocale";

import { describe, expect, it } from "vitest";

import {
	classifyGamePassOnSaleLimit,
	GamePassOnSaleLimitError,
} from "./game-pass-on-sale-limit.ts";

const LIMIT_MESSAGE =
	"The request parameter isForSale was invalid. Game pass on-sale limit has already been reached.";

function rejection(overrides: { details?: JSONValue; statusCode?: number } = {}): ApiError {
	return new ApiError(`HTTP 400: ${LIMIT_MESSAGE}`, {
		code: "BadRequest",
		details: { errorCode: "BadRequest", errorMessage: LIMIT_MESSAGE, field: "isForSale" },
		method: "POST",
		statusCode: 400,
		url: "https://apis.roblox.com/game-passes/v1/universes/1/game-passes",
		...overrides,
	});
}

describe(classifyGamePassOnSaleLimit, () => {
	it("should classify a 400 isForSale on-sale-limit rejection as a GamePassOnSaleLimitError", () => {
		expect.assertions(1);

		expect(classifyGamePassOnSaleLimit(rejection())).toBeInstanceOf(GamePassOnSaleLimitError);
	});

	it("should keep the original response and request context on the classified error", () => {
		expect.assertions(1);

		const original = rejection();
		const classified = classifyGamePassOnSaleLimit(original);

		expect(classified).toMatchObject({
			name: "GamePassOnSaleLimitError",
			cause: original,
			code: "BadRequest",
			details: original.details,
			message: original.message,
			method: "POST",
			statusCode: 400,
			url: original.url,
		});
	});

	it.for([
		{
			details: {
				errorCode: "BadRequest",
				errorMessage: "The request parameter isForSale was invalid.",
				field: "isForSale",
			},
			label: "different errorMessage",
			statusCode: 400,
		},
		{
			details: { errorCode: "BadRequest", errorMessage: LIMIT_MESSAGE, field: "price" },
			label: "different field",
			statusCode: 400,
		},
		{
			details: { errorCode: "BadRequest", errorMessage: LIMIT_MESSAGE },
			label: "missing field",
			statusCode: 400,
		},
		{
			details: { errorCode: "BadRequest", field: "isForSale" },
			label: "missing errorMessage",
			statusCode: 400,
		},
		{
			details: { errorMessage: LIMIT_MESSAGE, field: "isForSale" },
			label: "non-400 status",
			statusCode: 409,
		},
		{ details: [LIMIT_MESSAGE], label: "non-object body", statusCode: 400 },
	])(
		"should pass through an unrelated ApiError unchanged ($label)",
		({ details, statusCode }) => {
			expect.assertions(1);

			const original = rejection({ details, statusCode });

			expect(classifyGamePassOnSaleLimit(original)).toBe(original);
		},
	);

	it("should pass through a non-ApiError unchanged", () => {
		expect.assertions(1);

		const original = new NetworkError("Network request failed");

		expect(classifyGamePassOnSaleLimit(original)).toBe(original);
	});
});
