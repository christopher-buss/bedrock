import { assert, describe, it } from "vitest";

import { UnexpectedResponseError } from "../../../errors/unexpected-response.ts";
import { parseAssetResponse } from "./parsers.ts";

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
