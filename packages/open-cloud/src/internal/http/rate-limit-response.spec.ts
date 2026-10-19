// cspell:ignore dmaas
import { describe, expect, it } from "vitest";

import { classifyRateLimitSource, createRateLimitError } from "./rate-limit-response.ts";

const SERVICE_REASON = { "x-roblox-system-reason": "dmaas (Too Many Requests)" };
const EDGE_BODY = { errors: [{ code: 0, message: "" }] };

describe(classifyRateLimitSource, () => {
	it("should classify a system-reason header as a service refusal", () => {
		expect.assertions(1);

		expect(classifyRateLimitSource(SERVICE_REASON, undefined)).toBe("service");
	});

	it("should ignore a blank system-reason header", () => {
		expect.assertions(1);

		expect(classifyRateLimitSource({ "x-roblox-system-reason": " " }, EDGE_BODY)).toBe("edge");
	});

	it.for([
		{ body: { code: "RESOURCE_EXHAUSTED", message: "m" }, label: "top-level" },
		{ body: { error: { code: "RESOURCE_EXHAUSTED", message: "m" } }, label: "nested" },
	])("should classify a $label string body code as a service refusal", ({ body }) => {
		expect.assertions(1);

		expect(classifyRateLimitSource({}, body)).toBe("service");
	});

	it("should prefer service evidence over the edge body shape", () => {
		expect.assertions(1);

		expect(classifyRateLimitSource(SERVICE_REASON, EDGE_BODY)).toBe("service");
	});

	it("should classify the exact edge body without a system reason as an edge refusal", () => {
		expect.assertions(1);

		expect(
			classifyRateLimitSource(
				{},
				{
					errors: [
						{ code: 0, message: "" },
						{ code: 0, message: "" },
					],
				},
			),
		).toBe("edge");
	});

	it.for([
		{ body: undefined, label: "absent body" },
		{ body: JSON.parse("null"), label: "null body" },
		{ body: "<html>rate limited</html>", label: "text body" },
		{ body: { code: " " }, label: "blank code" },
		{ body: { code: 0 }, label: "numeric code" },
		{ body: { error: "RESOURCE_EXHAUSTED" }, label: "string error" },
		{ body: JSON.parse('{"error":null}'), label: "null error" },
		{ body: { error: { code: "" } }, label: "blank nested code" },
		{ body: { errors: [] }, label: "empty errors" },
		{ body: { errors: {} }, label: "non-array errors" },
		{ body: { errors: [{ code: 1, message: "" }] }, label: "non-zero entry code" },
		{ body: { errors: [{ code: 0, message: "slow" }] }, label: "non-empty entry message" },
		{ body: JSON.parse('{"errors":[null]}'), label: "null entry" },
		{ body: { errors: [{ code: 0, message: "" }, { code: 0 }] }, label: "partial entry" },
		{ body: [{ code: 0, message: "" }], label: "array body" },
	])("should classify a 429 with $label as unknown", ({ body }) => {
		expect.assertions(1);

		expect(classifyRateLimitSource({}, body)).toBe("unknown");
	});
});

describe(createRateLimitError, () => {
	it("should carry the dmaas evidence and source on the error", () => {
		expect.assertions(3);

		const body = {
			error: {
				code: "RESOURCE_EXHAUSTED",
				message:
					"RESOURCE_EXHAUSTED: Luau task creation rate limit exceeded. Retry after the indicated delay.",
			},
		};
		const response = new Response(undefined, {
			headers: { ...SERVICE_REASON, "retry-after": "515", "x-ratelimit-remaining": "4" },
			status: 429,
		});

		const error = createRateLimitError(response, body);

		expect(error.source).toBe("service");
		expect(error.code).toBe("RESOURCE_EXHAUSTED");
		expect(error.responseHeaders!["x-roblox-system-reason"]).toBe("dmaas (Too Many Requests)");
	});

	it("should mark an edge refusal as an edge source", () => {
		expect.assertions(2);

		const error = createRateLimitError(new Response(undefined, { status: 429 }), EDGE_BODY);

		expect(error.source).toBe("edge");
		expect(error.code).toBeUndefined();
	});
});
