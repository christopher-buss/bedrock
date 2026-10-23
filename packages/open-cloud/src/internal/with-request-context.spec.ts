import { describe, it } from "vitest";

import type { HttpRequest, HttpResponse } from "../client/types.ts";
import { ApiError } from "../errors/api-error.ts";
import { UnexpectedResponseError } from "../errors/unexpected-response.ts";
import { withRequestContext } from "./with-request-context.ts";

const REQUEST: HttpRequest = { method: "GET", url: "/cloud/v2/universes/1" };

const RESPONSE: HttpResponse = {
	body: { unexpected: true },
	headers: { "set-cookie": "secret", "x-roblox-edge": "edge-1" },
	status: 200,
};

describe(withRequestContext, () => {
	it("should add the method, full url, and allowlisted headers to an unexpected response", ({
		expect,
	}) => {
		expect.assertions(2);

		const err = new UnexpectedResponseError("Malformed universe response", {
			cause: new Error("shape"),
			code: "SHAPE",
			details: { unexpected: true },
			statusCode: 200,
		});

		const result = withRequestContext(err, {
			baseUrl: "https://apis.roblox.com/",
			request: REQUEST,
			response: RESPONSE,
		});

		expect(result.cause).toStrictEqual(new Error("shape"));
		expect(result).toMatchObject({
			code: "SHAPE",
			details: { unexpected: true },
			message: "Malformed universe response",
			method: "GET",
			responseHeaders: { "x-roblox-edge": "edge-1" },
			statusCode: 200,
			url: "https://apis.roblox.com/cloud/v2/universes/1",
		});
	});

	it("should join a base url that has no trailing slash", ({ expect }) => {
		expect.assertions(1);

		const err = new UnexpectedResponseError("Malformed universe response", {
			statusCode: 200,
		});

		const result = withRequestContext(err, {
			baseUrl: "https://apis.roblox.com",
			request: REQUEST,
			response: RESPONSE,
		});

		expect(result).toMatchObject({ url: "https://apis.roblox.com/cloud/v2/universes/1" });
	});

	it("should return any other error unchanged", ({ expect }) => {
		expect.assertions(1);

		const err = new ApiError("test parser rejection", { statusCode: 201 });

		const result = withRequestContext(err, {
			baseUrl: "https://apis.roblox.com",
			request: REQUEST,
			response: RESPONSE,
		});

		expect(result).toBe(err);
	});
});
